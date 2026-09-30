import { createServer } from 'node:http';
import { Writable } from 'node:stream';

import pinoHttp, { type HttpLogger } from 'pino-http';
import request from 'supertest';

import type { AppConfig } from '../../config/app.config';
import { AppRole } from '../../config/env.validation';
import { buildPinoHttpOptions } from './logger.module';
import { REDACTED, redactDeep } from './redact';

const PHONE = '+919812345678';
const EMAIL = 'priya.sharma@example.com';
const OTP = '482913';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.secret-token-value.sig';
const SECRETS = [PHONE, EMAIL, OTP, TOKEN];

const APP: AppConfig = {
  nodeEnv: 'test',
  role: AppRole.Api,
  sentryDsn: undefined,
  isProduction: false,
  port: 0,
  corsOrigins: [],
  trustProxy: undefined,
  logLevel: 'info',
  swaggerEnabled: false,
};

/** A pino-http logger with the app's options, writing JSON lines into memory. */
function capture(): { lines: string[]; middleware: HttpLogger } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { lines, middleware: pinoHttp({ ...buildPinoHttpOptions(APP), transport: undefined }, stream) };
}

describe('log redaction', () => {
  it('removes phone, email, otp and token at any depth', () => {
    const { lines, middleware } = capture();
    middleware.logger.info(
      {
        signup: { contact: { phone: PHONE, email: EMAIL } },
        deep: { a: { b: { c: { d: { otp: OTP, token: TOKEN } } } } },
        list: [{ user: { phone: PHONE } }, [{ email: EMAIL }]],
        headers: { Authorization: `Bearer ${TOKEN}` },
        safe: { userId: '01926b7e-0000-7000-8000-000000000001' },
      },
      'nested log',
    );
    const out = lines.join('');
    for (const s of SECRETS) expect(out).not.toContain(s);
    const entry = JSON.parse(lines[0]) as Record<string, any>;
    expect(entry.signup.contact).toEqual({ phone: REDACTED, email: REDACTED });
    expect(entry.deep.a.b.c.d).toEqual({ otp: REDACTED, token: REDACTED });
    expect(entry.list[1][0].email).toBe(REDACTED);
    expect(entry.headers.Authorization).toBe(REDACTED);
    expect(entry.safe.userId).toBe('01926b7e-0000-7000-8000-000000000001'); // non-sensitive data survives
  });

  it('redacts inside errors (e.g. details) but keeps message and stack', () => {
    const { lines, middleware } = capture();
    const err = Object.assign(new Error('delivery failed'), { details: { phone: PHONE, attempt: { otp: OTP } } });
    middleware.logger.error({ err }, 'sms error');
    const out = lines.join('');
    for (const s of [PHONE, OTP]) expect(out).not.toContain(s);
    const entry = JSON.parse(lines[0]) as { err: { message: string; stack: string; details: unknown } };
    expect(entry.err.message).toBe('delivery failed');
    expect(entry.err.stack).toContain('delivery failed');
    expect(entry.err.details).toEqual({ phone: REDACTED, attempt: { otp: REDACTED } });
  });

  it('keeps request logs free of auth headers and bodies', async () => {
    const { lines, middleware } = capture();
    const server = createServer((req, res) => {
      middleware(req, res);
      res.end('ok');
    });
    await request(server)
      .post('/api/v1/auth/verify-otp?x=1')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('Cookie', `session=${TOKEN}`)
      .send({ identifier: EMAIL, otp: OTP });
    const out = lines.join('');
    expect(out).toContain('request completed');
    for (const s of SECRETS) expect(out).not.toContain(s);
  });

  it('handles cycles and non-plain objects safely', () => {
    const a: Record<string, unknown> = { phone: PHONE };
    a.self = a;
    const out = redactDeep({ a, when: new Date(0) });
    expect(out.a).toEqual({ phone: REDACTED, self: '[Circular]' });
    expect(out.when).toBeInstanceOf(Date);
  });
});
