import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

import { applyTestEnv } from './test-env';
import { LOCAL_TEST_REDIS_DB } from './test-redis';

applyTestEnv();

// Connection details (DB_HOST, DB_USER, …) come from .env, like the app's.
// Values already set, such as DB_NAME and REDIS_URL above, are never overridden.
const envFile = resolve(__dirname, '../../.env');
if (existsSync(envFile)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(envFile, 'utf8')))) {
    process.env[key] ??= value;
  }
}

// global-setup.ts sets REDIS_URL; never let a test fall back to the dev Redis.
const redisUrl = process.env.REDIS_URL;
const db = redisUrl ? new URL(redisUrl).pathname.replace('/', '') || '0' : undefined;
if (!redisUrl || (db === '0' && process.env.TEST_REDIS_DISPOSABLE !== '1')) {
  throw new Error(
    `Tests need the test Redis (DB ${LOCAL_TEST_REDIS_DB} or a throwaway container); run them through jest so global-setup.ts runs`,
  );
}
