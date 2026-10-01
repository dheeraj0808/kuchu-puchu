import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Redis } from 'ioredis';
import request from 'supertest';

import type { JwtConfig } from '../../src/config/jwt.config';
import { REDIS_CLIENT } from '../../src/infra/redis/redis.module';
import { clearTestKeys } from '../support/test-redis';
import { createTestApp } from '../support/test-app';

/**
 * Two app instances in one process, each with its own Redis client, sharing
 * only the Redis server — the same situation as two API containers behind a
 * load balancer. Every limit must hold across both.
 * Each instance listens on its own port for the whole suite; letting supertest
 * open and close ephemeral servers per request can route a kept-alive socket
 * to the wrong instance.
 */
describe('Throttler on Redis (two instances)', () => {
  let appA: NestExpressApplication;
  let appB: NestExpressApplication;
  let servers: [string, string];
  let redis: Redis;
  let jwt: JwtConfig;

  beforeAll(async () => {
    appA = await createTestApp();
    appB = await createTestApp();
    await appA.listen(0, '127.0.0.1');
    await appB.listen(0, '127.0.0.1');
    servers = [await appA.getUrl(), await appB.getUrl()];
    expect(servers[0]).not.toBe(servers[1]);
    redis = appA.get<Redis>(REDIS_CLIENT);
    jwt = appA.get(ConfigService).getOrThrow<JwtConfig>('jwt');
  });

  afterAll(async () => {
    await appA?.close();
    await appB?.close();
  });

  beforeEach(async () => {
    await clearTestKeys(process.env.REDIS_URL as string);
  });

  /** Alternates A, B, A, B… so no single instance could enforce the limit alone. */
  const serverFor = (i: number): string => servers[i % 2];

  function accessToken(userId: string, secret = jwt.accessSecret): string {
    return new JwtService().sign(
      { sub: userId, sid: randomUUID(), role: 'user' },
      { secret, issuer: jwt.issuer, audience: jwt.audience, expiresIn: '5m', algorithm: 'HS256' },
    );
  }

  it('the instances do not share process memory, only Redis', () => {
    expect(appA.get(REDIS_CLIENT)).not.toBe(appB.get(REDIS_CLIENT));
  });

  it('a per-route limit (otp/request: 5/min per IP) is shared across instances', async () => {
    const ip = '198.51.100.1';
    for (let i = 0; i < 5; i++) {
      const res = await request(serverFor(i)).post('/api/v1/auth/otp/request').set('X-Forwarded-For', ip).send({});
      expect(res.status).toBe(400); // counted, then rejected by validation
    }
    for (const server of servers) {
      const res = await request(server).post('/api/v1/auth/otp/request').set('X-Forwarded-For', ip).send({});
      expect(res.status).toBe(429);
      expect(res.body).toMatchObject({ success: false, code: 'TOO_MANY_REQUESTS' });
      expect(res.body.details.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it('the global limit (100 / 60 s per IP) is shared across instances', async () => {
    const ip = '198.51.100.2';
    for (let i = 0; i < 100; i++) {
      const res = await request(serverFor(i)).get('/api/v1/auth/me').set('X-Forwarded-For', ip);
      expect(res.status).toBe(401);
    }
    for (const server of servers) {
      const res = await request(server).get('/api/v1/auth/me').set('X-Forwarded-For', ip);
      expect(res.status).toBe(429);
    }
    // Another client is unaffected.
    await request(servers[0]).get('/api/v1/auth/me').set('X-Forwarded-For', '198.51.100.3').expect(401);
  });

  it('the per-user limit follows the user id across instances and client IPs', async () => {
    const user = randomUUID();
    const token = accessToken(user);
    // 100 requests, each from a different IP, so only the user budget can run out.
    for (let i = 0; i < 100; i++) {
      const res = await request(serverFor(i))
        .get('/api/v1/auth/me')
        .set('X-Forwarded-For', `10.1.${Math.floor(i / 250)}.${(i % 250) + 1}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401); // valid signature, but no session row
    }
    const blocked = await request(servers[1])
      .get('/api/v1/auth/me')
      .set('X-Forwarded-For', '10.2.0.1')
      .set('Authorization', `Bearer ${token}`);
    expect(blocked.status).toBe(429);

    // A different user from a fresh IP still gets through.
    await request(servers[0])
      .get('/api/v1/auth/me')
      .set('X-Forwarded-For', '10.2.0.2')
      .set('Authorization', `Bearer ${accessToken(randomUUID())}`)
      .expect(401);

    expect(Number(await redis.get(`kp:throttle:user:global:${user}`))).toBeGreaterThanOrEqual(100);
  });

  it('a forged token is not counted against that user', async () => {
    const victim = randomUUID();
    const forged = accessToken(victim, 'f'.repeat(48));
    await request(servers[0])
      .get('/api/v1/auth/me')
      .set('X-Forwarded-For', '198.51.100.4')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
    expect(await redis.exists(`kp:throttle:user:global:${victim}`)).toBe(0);
    expect(await redis.exists('kp:throttle:ip:global:198.51.100.4')).toBe(1);
  });

  it('stores counters only under the kp:throttle: prefix', async () => {
    await request(servers[0]).get('/api/v1/auth/me').set('X-Forwarded-For', '198.51.100.5').expect(401);
    const keys = await redis.keys('*');
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith('kp:throttle:'))).toBe(true);
  });

  it('health checks are never rate limited', async () => {
    for (let i = 0; i < 120; i++) {
      await request(serverFor(i)).get('/api/v1/health').set('X-Forwarded-For', '198.51.100.6').expect(200);
    }
  });
});
