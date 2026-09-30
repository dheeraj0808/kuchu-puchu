import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';

describe('App (e2e)', () => {
  let app: NestExpressApplication;
  let server: App;

  beforeAll(async () => {
    process.env.SWAGGER_ENABLED = 'true';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({ logger: false });
    await configureApp(app);
    server = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves routes under /api/v1 with the §4.1 success body', async () => {
    const res = await request(server).get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ success: true, data: { status: 'ok' } });
  });

  /** Every error is exactly the §4.1 body and never echoes the path or Nest's default text. */
  function expectErrorBody(res: request.Response, status: number, code: string, path?: string): void {
    expect(res.status).toBe(status);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(Object.keys(res.body as object).filter((k) => k !== 'details').sort()).toEqual([
      'code',
      'message',
      'requestId',
      'success',
    ]);
    expect(res.body).toMatchObject({ success: false, code });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
    expect(res.text).not.toContain('Cannot ');
    if (path && path !== '/') expect(res.text).not.toContain(path);
  }

  it.each(['/api/health', '/does-not-exist', '/', '/api/v1/does-not-exist'])(
    'unknown path %s → 404 NOT_FOUND JSON',
    async (path) => {
      const res = await request(server).get(path);
      expectErrorBody(res, 404, 'NOT_FOUND', path);
      expect(res.body.message).toBe('Not found');
      expect(res.body.details).toBeUndefined();
    },
  );

  it('wrong HTTP method on an existing path → 404 JSON', async () => {
    const res = await request(server).delete('/api/v1/health');
    expectErrorBody(res, 404, 'NOT_FOUND', '/api/v1/health');
    expect(res.body.message).toBe('Not found');
  });

  it('malformed JSON body → 400 VALIDATION_ERROR', async () => {
    const res = await request(server)
      .post('/api/v1/auth/logout')
      .set('Content-Type', 'application/json')
      .send('{"refreshToken": ');
    expectErrorBody(res, 400, 'VALIDATION_ERROR', '/api/v1/auth/logout');
    expect(res.body.details.errors).toEqual(['Request body is not valid JSON']);
    // The parser's own message ("Unexpected end of JSON input") is not leaked.
    expect(res.text).not.toMatch(/Unexpected|JSON input/);
  });

  it('JSON body over 100 kb → 413 PAYLOAD_TOO_LARGE JSON', async () => {
    const res = await request(server)
      .post('/api/v1/auth/logout')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ refreshToken: 'x'.repeat(101 * 1024) }));
    expectErrorBody(res, 413, 'PAYLOAD_TOO_LARGE', '/api/v1/auth/logout');
    expect(res.body.message).toBe('Request body is too large');
  });

  it('body errors outside the prefix are JSON too', async () => {
    const res = await request(server)
      .post('/does-not-exist')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expectErrorBody(res, 400, 'VALIDATION_ERROR', '/does-not-exist');
  });

  it('returns VALIDATION_ERROR with details.errors for a bad body', async () => {
    const res = await request(server)
      .post('/api/v1/auth/request-otp')
      .set('X-Request-Id', 'e2e-validation-1')
      .send({ unknownField: true })
      .expect(400);
    expect(Object.keys(res.body).sort()).toEqual(['code', 'details', 'message', 'requestId', 'success']);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.requestId).toBe('e2e-validation-1');
    expect(Array.isArray(res.body.details.errors)).toBe(true);
  });

  it('answers 429 with details.retryAfterSeconds when a route limit is hit', async () => {
    // POST /auth/request-otp allows 5 per minute per IP; the throttler runs before validation.
    let last: request.Response | undefined;
    for (let i = 0; i < 7; i++) {
      last = await request(server).post('/api/v1/auth/request-otp').send({});
      if (last.status === 429) break;
    }
    expect(last?.status).toBe(429);
    expect(last?.body).toMatchObject({ success: false, code: 'TOO_MANY_REQUESTS' });
    expect(last?.body.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('documents the versioned paths in Swagger at /api/docs', async () => {
    const res = await request(server).get('/api/docs-json').expect(200);
    const paths = Object.keys((res.body as { paths: Record<string, unknown> }).paths);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.startsWith('/api/v1/'))).toBe(true);
  });
});
