import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Redis } from 'ioredis';
import { Sequelize } from 'sequelize-typescript';
import request from 'supertest';
import { App } from 'supertest/types';

import type { JwtConfig } from '../src/config/jwt.config';
import { REDIS_CLIENT } from '../src/infra/redis/redis.module';
import { createTestApp } from './support/test-app';

const LIVENESS = '/api/v1/health';
const READINESS = '/api/v1/health/ready';

describe('Health (e2e)', () => {
  let app: NestExpressApplication;
  let server: App;
  let sequelize: Sequelize;
  let redis: Redis;

  beforeAll(async () => {
    process.env.SWAGGER_ENABLED = 'true';
    app = await createTestApp();
    // Bound once, so concurrent supertest calls share it instead of each starting a listener.
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as App;
    sequelize = app.get(Sequelize);
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app.close();
  });

  /** A real access token (valid signature, issuer, audience), so the per-user throttler would count it. */
  function accessToken(): string {
    const jwt = app.get(ConfigService).getOrThrow<JwtConfig>('jwt');
    return new JwtService().sign(
      { sub: randomUUID() },
      { secret: jwt.accessSecret, issuer: jwt.issuer, audience: jwt.audience, algorithm: 'HS256', expiresIn: 300 },
    );
  }

  function expectUnavailable(res: request.Response, checks: { mysql: string; redis: string }): void {
    expect(res.status).toBe(503);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      success: false,
      code: 'PROVIDER_UNAVAILABLE',
      message: expect.any(String),
      details: { checks },
      requestId: res.headers['x-request-id'],
    });
  }

  describe('GET /api/v1/health (liveness)', () => {
    it('200 with the §4.1 success body and no-store, without an auth header', async () => {
      const res = await request(server).get(LIVENESS).expect(200);
      expect(res.body).toEqual({ success: true, data: { status: 'ok' } });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('checks no dependencies: still 200 while MySQL and Redis are down', async () => {
      const query = jest.spyOn(sequelize, 'query').mockRejectedValue(new Error('down'));
      const ping = jest.spyOn(redis, 'ping').mockRejectedValue(new Error('down'));
      await request(server).get(LIVENESS).expect(200);
      expect(query).not.toHaveBeenCalled();
      expect(ping).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/health/ready (readiness)', () => {
    it('200 with both checks up against the real MySQL and Redis, without an auth header', async () => {
      const res = await request(server).get(READINESS).expect(200);
      expect(res.body).toEqual({
        success: true,
        data: { status: 'ready', checks: { mysql: 'up', redis: 'up' } },
      });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('503 PROVIDER_UNAVAILABLE when MySQL is down, with no error text in the body', async () => {
      jest
        .spyOn(sequelize, 'query')
        .mockRejectedValueOnce(new Error('connect ECONNREFUSED db.internal:3306 (MySQL 8.4.11)'));
      const res = await request(server).get(READINESS);
      expectUnavailable(res, { mysql: 'down', redis: 'up' });
      expect(res.text).not.toMatch(/ECONNREFUSED|db\.internal|3306|8\.4/);
    });

    it('503 PROVIDER_UNAVAILABLE when Redis is down, with no error text in the body', async () => {
      jest.spyOn(redis, 'ping').mockRejectedValueOnce(new Error('connect ECONNREFUSED cache.internal:6379'));
      const res = await request(server).get(READINESS);
      expectUnavailable(res, { mysql: 'up', redis: 'down' });
      expect(res.text).not.toMatch(/ECONNREFUSED|cache\.internal|6379/);
    });

    it('503 when a check takes longer than 1 s, answering after ~1 s rather than waiting', async () => {
      let finishSlowCheck: () => void = () => undefined;
      const slow = new Promise<void>((resolve) => (finishSlowCheck = resolve));
      jest.spyOn(sequelize, 'query').mockImplementationOnce(async () => {
        await slow;
        return [[], 0];
      });

      const started = Date.now();
      const res = await request(server).get(READINESS);
      const elapsed = Date.now() - started;
      finishSlowCheck();

      expectUnavailable(res, { mysql: 'down', redis: 'up' });
      expect(elapsed).toBeGreaterThanOrEqual(950);
      expect(elapsed).toBeLessThan(1_500);
    });

    it('recovers to 200 once the dependency answers again', async () => {
      jest.spyOn(redis, 'ping').mockRejectedValueOnce(new Error('down'));
      await request(server).get(READINESS).expect(503);
      await request(server).get(READINESS).expect(200);
    });
  });

  describe('both endpoints', () => {
    it('150 rapid calls never return 429 (per-IP and per-user limits skipped)', async () => {
      // A valid token on half the calls, so the per-user throttler would count them too.
      const token = accessToken();
      const statuses: number[] = [];
      for (const path of [LIVENESS, READINESS]) {
        for (let batch = 0; batch < 150; batch += 25) {
          const responses = await Promise.all(
            Array.from({ length: 25 }, (_, i) => {
              const call = request(server).get(path);
              return (batch + i) % 2 === 0 ? call.set('Authorization', `Bearer ${token}`) : call;
            }),
          );
          statuses.push(...responses.map((r) => r.status));
        }
      }
      expect(statuses).toHaveLength(300);
      expect(statuses.every((s) => s === 200)).toBe(true);
    });

    it.each([LIVENESS, READINESS])('%s needs no auth: an invalid bearer token is ignored', async (path) => {
      await request(server).get(path).set('Authorization', 'Bearer not-a-token').expect(200);
    });

    it('are documented in Swagger as public operations', async () => {
      const res = await request(server).get('/api/docs-json').expect(200);
      const doc = res.body as {
        paths: Record<string, { get?: { security?: unknown; responses: Record<string, unknown> } }>;
      };
      const liveness = doc.paths[LIVENESS]?.get;
      const readiness = doc.paths[READINESS]?.get;
      expect(Object.keys(liveness?.responses ?? {})).toEqual(['200']);
      expect(Object.keys(readiness?.responses ?? {}).sort()).toEqual(['200', '503']);
      expect(liveness?.security).toBeUndefined();
      expect(readiness?.security).toBeUndefined();
    });
  });
});
