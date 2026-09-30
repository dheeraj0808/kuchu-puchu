import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { startTestMysql } from './test-mysql';
import { applyTestEnv } from './test-env';
import { clearTestKeys, startTestRedis } from './test-redis';

type GlobalWithContainers = typeof globalThis & { __TEST_CONTAINERS_STOP__?: Array<() => Promise<void>> };

/**
 * Runs once per `jest` run: points tests at the test Redis and the test MySQL
 * database (throwaway containers in CI), clears leftover kp:* keys, then
 * migrates and seeds the test database. Workers inherit the env vars set here.
 */
export default async function globalSetup(): Promise<void> {
  applyTestEnv();
  const stops: Array<() => Promise<void>> = [];
  (globalThis as GlobalWithContainers).__TEST_CONTAINERS_STOP__ = stops;

  const [redis, mysql] = await Promise.all([startTestRedis(), startTestMysql()]);
  stops.push(redis.stop, mysql.stop);
  process.env.REDIS_URL = redis.url;
  await clearTestKeys(redis.url);
  console.log(`\n[test] Redis: ${redis.source} · MySQL: ${mysql.source}, database ${process.env.DB_NAME}`);

  const root = resolve(__dirname, '../..');
  const tsNode = resolve(root, 'node_modules/.bin/ts-node');
  for (const command of ['db:create', 'up', 'seed']) {
    execFileSync(tsNode, ['src/database/migrate.ts', command], { cwd: root, env: process.env, stdio: 'pipe' });
  }
}
