import { applyTestEnv } from './test-env';
import { LOCAL_TEST_REDIS_DB } from './test-redis';

applyTestEnv();

// global-setup.ts sets REDIS_URL; never let a test fall back to the dev Redis.
const redisUrl = process.env.REDIS_URL;
const db = redisUrl ? new URL(redisUrl).pathname.replace('/', '') || '0' : undefined;
if (!redisUrl || (db === '0' && process.env.TEST_REDIS_DISPOSABLE !== '1')) {
  throw new Error(
    `Tests need the test Redis (DB ${LOCAL_TEST_REDIS_DB} or a throwaway container); run them through jest so global-setup.ts runs`,
  );
}
