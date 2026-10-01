import 'reflect-metadata';

import appConfig from './app.config';
import databaseConfig from './database.config';
import { resolveAppRole, validateEnv } from './env.validation';
import otpConfig from './otp.config';
import outboxConfig, { OUTBOX_CLEANUP_BATCH_SIZE } from './outbox.config';
import { alertsConfig } from './integrations.config';

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
  REDIS_URL: 'rediss://cache.internal:6379',
  ALERT_WEBHOOK_URL: 'https://hooks.example.com/services/T000/B000/XXXX',
  // Passes validation; createSmsProvider still refuses it until that adapter exists.
  SMS_PROVIDER: 'dlt-sms',
  EMAIL_FROM: 'no-reply@kuchupuchu.example',
  SES_REGION: 'ap-south-1',
  AWS_REGION: 'ap-south-1',
  S3_BUCKET_PRIVATE: 'kuchu-puchu-private',
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

  it('M06: production refuses SMS_PROVIDER unset or "fake", and needs EMAIL_FROM + SES_REGION', () => {
    const { SMS_PROVIDER: _s, ...noSms } = prod;
    expect(() => validateEnv(noSms)).toThrow('SMS_PROVIDER must name a real SMS provider in production');
    expect(() => validateEnv({ ...prod, SMS_PROVIDER: 'fake' })).toThrow('SMS_PROVIDER');
    const { EMAIL_FROM: _e, ...noEmail } = prod;
    expect(() => validateEnv(noEmail)).toThrow('EMAIL_FROM and SES_REGION must be set in production');
    expect(() => validateEnv({ ...base, SMS_PROVIDER: 'fake' })).not.toThrow();
  });

  it('M06: OTP / session / SMS defaults and formats (Appendix D)', () => {
    const env = validateEnv(base);
    expect(env).toMatchObject({
      SESSION_SLIDING_DAYS: 30,
      SESSION_MAX_DAYS: 90,
      OTP_MAX_PER_IP_PER_HOUR: 20,
      OTP_SMS_ALLOWED_COUNTRIES: '+91',
      SMS_DAILY_BUDGET: 10_000,
    });
    expect(() => validateEnv({ ...base, OTP_SMS_ALLOWED_COUNTRIES: '+91,+971' })).not.toThrow();
    expect(() => validateEnv({ ...base, OTP_SMS_ALLOWED_COUNTRIES: '91' })).toThrow('OTP_SMS_ALLOWED_COUNTRIES');
    expect(() => validateEnv({ ...base, SESSION_SLIDING_DAYS: '100', SESSION_MAX_DAYS: '90' })).toThrow('SESSION_SLIDING_DAYS');
    expect(() => validateEnv({ ...base, SES_REGION: 'mars' })).toThrow('SES_REGION');
    validateEnv(base);
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

  it('fix(M06): SMS pool share, email budget, device / step-up caps and the session cap have defaults and bounds', () => {
    const env = validateEnv(base);
    expect(env).toMatchObject({
      SMS_BUDGET_NEW_IDENTIFIER_PERCENT: 70,
      EMAIL_DAILY_BUDGET: 20_000,
      OTP_MAX_PER_DEVICE_PER_HOUR: 10,
      OTP_REAUTH_MAX_PER_HOUR: 5,
      SESSION_MAX_PER_USER: 10,
    });
    expect(validateEnv({ ...base, SMS_BUDGET_NEW_IDENTIFIER_PERCENT: '0' }).SMS_BUDGET_NEW_IDENTIFIER_PERCENT).toBe(0);
    expect(() => validateEnv({ ...base, SMS_BUDGET_NEW_IDENTIFIER_PERCENT: '101' })).toThrow('SMS_BUDGET_NEW_IDENTIFIER_PERCENT');
    expect(() => validateEnv({ ...base, EMAIL_DAILY_BUDGET: '0' })).toThrow('EMAIL_DAILY_BUDGET');
    expect(() => validateEnv({ ...base, OTP_MAX_PER_DEVICE_PER_HOUR: '0' })).toThrow('OTP_MAX_PER_DEVICE_PER_HOUR');
    expect(() => validateEnv({ ...base, SESSION_MAX_PER_USER: '0' })).toThrow('SESSION_MAX_PER_USER');
  });

  it('M07: production needs AWS_REGION and S3_BUCKET_PRIVATE; bucket names are validated', () => {
    expect(() => validateEnv({ ...prod, S3_BUCKET_PRIVATE: undefined })).toThrow('S3_BUCKET_PRIVATE must be set in production');
    expect(() => validateEnv({ ...prod, AWS_REGION: undefined })).toThrow('S3_BUCKET_PRIVATE needs AWS_REGION');
    expect(() => validateEnv({ ...prod, AWS_REGION: undefined, S3_BUCKET_PRIVATE: undefined })).toThrow('AWS_REGION and S3_BUCKET_PRIVATE must be set in production');
    expect(() => validateEnv({ ...base, S3_BUCKET_PRIVATE: 'Bad_Bucket' })).toThrow('S3_BUCKET_PRIVATE');
    expect(validateEnv(base).S3_BUCKET_PRIVATE).toBeUndefined();
    expect(() => validateEnv({ ...base, S3_BUCKET_PRIVATE: 'kp-private' })).toThrow('S3_BUCKET_PRIVATE needs AWS_REGION');
  });

  it('rejects OTP_DEV_ECHO in production', () => {
    expect(() => validateEnv({ ...prod, OTP_DEV_ECHO: 'true' })).toThrow(/OTP_DEV_ECHO/);
  });

  it('requires CORS_ORIGINS in production', () => {
    expect(() => validateEnv({ ...prod, CORS_ORIGINS: '' })).toThrow(/CORS_ORIGINS/);
  });

  it('M06 review: production refuses a TRUST_PROXY that trusts any X-Forwarded-For', () => {
    for (const bad of ['true', 'yes', '0', '1.2.3.4, *', '0.0.0.0/1,128.0.0.0/1', '::/0', '2001::/16']) expect(() => validateEnv({ ...prod, TRUST_PROXY: bad })).toThrow(/TRUST_PROXY/);
    for (const ok of ['1', '2', 'loopback', '10.0.0.0/8, 172.16.0.0/12', 'uniquelocal']) {
      expect(() => validateEnv({ ...prod, TRUST_PROXY: ok })).not.toThrow();
    }
    validateEnv(base);
  });

  it('M06 review: OTP_DEV_ECHO is refused outside development and test (staging too)', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'staging', OTP_DEV_ECHO: 'true' })).toThrow('OTP_DEV_ECHO');
    expect(() => validateEnv({ ...base, NODE_ENV: 'development', OTP_DEV_ECHO: 'true' })).not.toThrow();
    validateEnv(base);
  });

  it('requires TRUST_PROXY in production only', () => {
    expect(() => validateEnv({ ...prod, TRUST_PROXY: undefined })).toThrow(/TRUST_PROXY/);
    expect(() => validateEnv({ ...base, TRUST_PROXY: undefined })).not.toThrow();
  });

  it('requires REDIS_URL in production only', () => {
    expect(() => validateEnv({ ...prod, REDIS_URL: undefined })).toThrow(/REDIS_URL/);
    expect(() => validateEnv({ ...base, REDIS_URL: undefined })).not.toThrow();
  });

  it('requires an https ALERT_WEBHOOK_URL in production only', () => {
    expect(() => validateEnv({ ...prod, ALERT_WEBHOOK_URL: undefined })).toThrow(/ALERT_WEBHOOK_URL must be set/);
    expect(() => validateEnv({ ...base, ALERT_WEBHOOK_URL: undefined })).not.toThrow();
    expect(() => validateEnv({ ...base, ALERT_WEBHOOK_URL: 'http://hooks.example.com/x' })).toThrow(/ALERT_WEBHOOK_URL/);
  });

  it('defaults the OUTBOX_* variables to the M03 values', () => {
    const env = validateEnv(base);
    expect(env.OUTBOX_RELAY_INTERVAL_MS).toBe(1000);
    expect(env.OUTBOX_RELAY_TIME_BUDGET_MS).toBe(800);
    expect(env.OUTBOX_BATCH_SIZE).toBe(200);
    expect(env.OUTBOX_MAX_ATTEMPTS).toBe(8);
    expect(env.OUTBOX_BACKOFF_BASE_MS).toBe(1000);
    expect(env.OUTBOX_ENQUEUE_TIMEOUT_MS).toBe(1000);
    expect(env.OUTBOX_CLEANUP_AGE_DAYS).toBe(7);
    expect(env.OUTBOX_CLEANUP_CRON).toBe('30 21 * * *');
    expect(env.OUTBOX_PAYLOAD_MAX_BYTES).toBe(16_384);
    expect(env.OUTBOX_COMPLETED_JOB_RETENTION_HOURS).toBe(24);
    expect(env.OUTBOX_FAILED_JOB_RETENTION_DAYS).toBe(14);
  });

  it('lets OUTBOX_* be overridden and rejects out-of-range values', () => {
    const env = validateEnv({ ...base, OUTBOX_BATCH_SIZE: '50', OUTBOX_CLEANUP_CRON: '0 22 * * *' });
    expect(env.OUTBOX_BATCH_SIZE).toBe(50);
    expect(env.OUTBOX_CLEANUP_CRON).toBe('0 22 * * *');
    expect(() => validateEnv({ ...base, OUTBOX_BATCH_SIZE: '0' })).toThrow(/OUTBOX_BATCH_SIZE/);
    expect(() => validateEnv({ ...base, OUTBOX_MAX_ATTEMPTS: '300' })).toThrow(/OUTBOX_MAX_ATTEMPTS/);
    expect(() => validateEnv({ ...base, OUTBOX_CLEANUP_CRON: 'daily' })).toThrow(/OUTBOX_CLEANUP_CRON/);
    expect(() => validateEnv({ ...base, OUTBOX_RELAY_TIME_BUDGET_MS: '1000' })).toThrow(
      /OUTBOX_RELAY_TIME_BUDGET_MS must be below/,
    );
  });

  it('runs as api when APP_ROLE is not set, and accepts only api | realtime | worker', () => {
    expect(validateEnv(base).APP_ROLE).toBeUndefined();
    expect(resolveAppRole(validateEnv(base))).toBe('api');
    expect(validateEnv({ ...base, APP_ROLE: 'worker' }).APP_ROLE).toBe('worker');
    expect(() => validateEnv({ ...base, APP_ROLE: 'cron' })).toThrow(/APP_ROLE/);
  });

  it('accepts an optional https SENTRY_DSN only', () => {
    expect(validateEnv(base).SENTRY_DSN).toBeUndefined();
    expect(() => validateEnv({ ...base, SENTRY_DSN: 'https://key@o1.ingest.sentry.io/1' })).not.toThrow();
    expect(() => validateEnv({ ...base, SENTRY_DSN: 'not-a-url' })).toThrow(/SENTRY_DSN/);
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

  it('build the typed outbox and alerts config', () => {
    validateEnv({ ...base, OUTBOX_FAILED_JOB_RETENTION_DAYS: '2' });
    expect(outboxConfig()).toEqual({
      relayIntervalMs: 1000,
      relayTimeBudgetMs: 800,
      batchSize: 200,
      maxAttempts: 8,
      backoffBaseMs: 1000,
      enqueueTimeoutMs: 1000,
      cleanupAgeDays: 7,
      cleanupCron: '30 21 * * *',
      cleanupBatchSize: OUTBOX_CLEANUP_BATCH_SIZE,
      payloadMaxBytes: 16_384,
      completedJobRetentionSeconds: 24 * 3600,
      failedJobRetentionSeconds: 2 * 86_400,
    });
    expect(OUTBOX_CLEANUP_BATCH_SIZE).toBe(5000);
    expect(alertsConfig()).toEqual({ webhookUrl: undefined, environment: 'development' });
    validateEnv(base);
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
