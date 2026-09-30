import 'reflect-metadata';

import appConfig from './app.config';
import databaseConfig from './database.config';
import { validateEnv } from './env.validation';
import otpConfig from './otp.config';

const secret = (c: string) => c.repeat(40);

const base = {
  NODE_ENV: 'development',
  DB_HOST: 'localhost',
  DB_USER: 'app',
  DB_NAME: 'kuchu_puchu',
  JWT_ACCESS_SECRET: secret('a'),
  JWT_REFRESH_SECRET: secret('b'),
  OTP_HASH_SECRET: secret('c'),
};

const prod = {
  ...base,
  NODE_ENV: 'production',
  CORS_ORIGINS: 'https://app.example.com',
  TRUST_PROXY: '1',
};

describe('validateEnv', () => {
  it('parses booleans and numbers from strings', () => {
    const env = validateEnv({ ...base, OTP_DEV_ECHO: 'false', SWAGGER_ENABLED: 'true', PORT: '4000' });
    expect(env.OTP_DEV_ECHO).toBe(false);
    expect(env.SWAGGER_ENABLED).toBe(true);
    expect(env.PORT).toBe(4000);
  });

  it('accepts a complete production environment', () => {
    expect(() => validateEnv(prod)).not.toThrow();
  });

  it.each(['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'OTP_HASH_SECRET'])(
    'fails fast when %s is missing',
    (key) => {
      const env: Record<string, unknown> = { ...base };
      delete env[key];
      expect(() => validateEnv(env)).toThrow(new RegExp(key));
    },
  );

  it.each(['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'OTP_HASH_SECRET'])('rejects a %s shorter than 32 chars', (key) => {
    expect(() => validateEnv({ ...base, [key]: 'x'.repeat(31) })).toThrow(new RegExp(key));
  });

  it.each([
    ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'],
    ['JWT_ACCESS_SECRET', 'OTP_HASH_SECRET'],
    ['JWT_REFRESH_SECRET', 'OTP_HASH_SECRET'],
  ])('rejects %s equal to %s', (a, b) => {
    expect(() => validateEnv({ ...base, [a]: secret('z'), [b]: secret('z') })).toThrow(/must differ/);
  });

  it('rejects OTP_DEV_ECHO in production', () => {
    expect(() => validateEnv({ ...prod, OTP_DEV_ECHO: 'true' })).toThrow(/OTP_DEV_ECHO/);
  });

  it('requires CORS_ORIGINS in production', () => {
    expect(() => validateEnv({ ...prod, CORS_ORIGINS: '' })).toThrow(/CORS_ORIGINS/);
  });

  it('requires TRUST_PROXY in production only', () => {
    expect(() => validateEnv({ ...prod, TRUST_PROXY: undefined })).toThrow(/TRUST_PROXY/);
    expect(() => validateEnv({ ...base, TRUST_PROXY: undefined })).not.toThrow();
  });

  it('rejects a REDIS_URL that is not a redis URL', () => {
    expect(() => validateEnv({ ...base, REDIS_URL: 'localhost:6379' })).toThrow(/REDIS_URL/);
    expect(() => validateEnv({ ...base, REDIS_URL: 'redis://localhost:6379' })).not.toThrow();
  });

  it('defaults DB_POOL_MAX to 20 and rejects values below the pool minimum', () => {
    expect(validateEnv(base).DB_POOL_MAX).toBe(20);
    expect(() => validateEnv({ ...base, DB_POOL_MAX: '1' })).toThrow(/DB_POOL_MAX/);
  });

  it('never echoes secret values in errors', () => {
    try {
      validateEnv({ ...base, OTP_HASH_SECRET: 'tiny-secret-value' });
      fail('expected throw');
    } catch (e) {
      expect((e as Error).message).not.toContain('tiny-secret-value');
    }
  });
});

describe('config loaders', () => {
  it('read the validated values, not process.env', () => {
    const before = process.env.DB_USER;
    process.env.DB_USER = 'from-process-env';
    try {
      validateEnv({ ...base, DB_USER: 'validated-user', DB_POOL_MAX: '7' });
      const db = databaseConfig();
      expect(db.username).toBe('validated-user');
      expect(db.poolMin).toBe(2);
      expect(db.poolMax).toBe(7);
    } finally {
      if (before === undefined) delete process.env.DB_USER;
      else process.env.DB_USER = before;
    }
  });

  it('turn Swagger off by default in production and force OTP echo off', () => {
    validateEnv(prod);
    expect(appConfig().swaggerEnabled).toBe(false);
    expect(appConfig().trustProxy).toBe('1');
    expect(otpConfig().devEcho).toBe(false);
    validateEnv(base);
    expect(appConfig().swaggerEnabled).toBe(true);
  });
});
