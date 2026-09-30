import 'reflect-metadata';

import { validateEnv } from './env.validation';

const secret = (c: string) => c.repeat(40);

const base = {
  NODE_ENV: 'development',
  DB_HOST: 'localhost',
  DB_USERNAME: 'app',
  DB_DATABASE: 'kuchu_puchu',
  JWT_ACCESS_SECRET: secret('a'),
  JWT_REFRESH_SECRET: secret('b'),
  OTP_HASH_SECRET: secret('c'),
};

describe('validateEnv', () => {
  it('parses booleans and numbers from strings', () => {
    const env = validateEnv({ ...base, OTP_DEV_ECHO: 'false', SWAGGER_ENABLED: 'true', PORT: '4000' });
    expect(env.OTP_DEV_ECHO).toBe(false);
    expect(env.SWAGGER_ENABLED).toBe(true);
    expect(env.PORT).toBe(4000);
  });

  it('rejects short secrets', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects identical access and refresh secrets', () => {
    expect(() => validateEnv({ ...base, JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET })).toThrow();
  });

  it('rejects OTP_DEV_ECHO in production', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example.com', OTP_DEV_ECHO: 'true' }),
    ).toThrow(/OTP_DEV_ECHO/);
  });

  it('requires CORS_ORIGINS in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/CORS_ORIGINS/);
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
