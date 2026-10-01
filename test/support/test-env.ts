/**
 * Test environment guard. Tests must never touch dev data, so they always use
 * a dedicated MySQL database whose name ends in "_test" (default
 * kuchu_puchu_test) and a dedicated Redis (see test-redis.ts). Values set here win over .env, which ConfigModule and
 * migrate.ts load without overriding existing variables.
 */
export const TEST_DB_NAME = process.env.TEST_DB_NAME ?? 'kuchu_puchu_test';

export function applyTestEnv(): void {
  if (!TEST_DB_NAME.endsWith('_test')) {
    throw new Error(`Refusing to run tests against "${TEST_DB_NAME}": the test database name must end in "_test"`);
  }
  process.env.NODE_ENV = 'test';
  process.env.DB_NAME = TEST_DB_NAME;
  process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';
  // Tests talk to the app over loopback; trusting it lets a test simulate
  // different client IPs with X-Forwarded-For.
  process.env.TRUST_PROXY = 'loopback';
  // Codes are read from the fake providers; never echoed to stdout.
  process.env.OTP_DEV_ECHO = 'false';
  process.env.SMS_PROVIDER = 'fake';
  delete process.env.EMAIL_FROM;
  delete process.env.SES_REGION;
}
