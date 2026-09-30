import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { applyTestEnv } from './test-env';
import { clearTestKeys, startTestRedis } from './test-redis';

type GlobalWithRedis = typeof globalThis & { __TEST_REDIS_STOP__?: () => Promise<void> };

/**
 * Runs once per `jest` run: points tests at the test Redis and the test MySQL
 * database, clears leftover kp:* keys, and migrates the test database.
 * Workers inherit the env vars set here.
 */
export default async function globalSetup(): Promise<void> {
  applyTestEnv();

  const redis = await startTestRedis();
  process.env.REDIS_URL = redis.url;
  (globalThis as GlobalWithRedis).__TEST_REDIS_STOP__ = redis.stop;
  await clearTestKeys(redis.url);
  console.log(`\n[test] Redis: ${redis.source} · MySQL database: ${process.env.DB_NAME}`);

  const root = resolve(__dirname, '../..');
  const tsNode = resolve(root, 'node_modules/.bin/ts-node');
  for (const command of ['db:create', 'up', 'seed']) {
    execFileSync(tsNode, ['src/database/migrate.ts', command], { cwd: root, env: process.env, stdio: 'pipe' });
  }
}
