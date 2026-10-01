import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

  // log-scan.ts appends one line per test file; global-teardown.ts prints the total.
  process.env.TEST_LOG_SCAN_REPORT = resolve(tmpdir(), `kp-log-scan-${process.pid}.jsonl`);
  writeFileSync(process.env.TEST_LOG_SCAN_REPORT, '');

  const root = resolve(__dirname, '../..');
  const tsNode = resolve(root, 'node_modules/.bin/ts-node');
  for (const command of ['db:create', 'up', 'seed']) {
    const out = execFileSync(tsNode, ['src/database/migrate.ts', command], { cwd: root, env: process.env, stdio: 'pipe' });
    // Data-changing migrations print what they did (e.g. "[M06] sessions: deleted 545 rows").
    for (const line of out.toString().split('\n')) if (line.startsWith('[M')) console.log(`[test] ${line}`);
  }
}
