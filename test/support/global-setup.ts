import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { applyTestEnv } from './test-env';

/** Creates the test database if needed and brings it up to the latest migration. */
export default function globalSetup(): void {
  applyTestEnv();
  const root = resolve(__dirname, '../..');
  const tsNode = resolve(root, 'node_modules/.bin/ts-node');
  for (const command of ['db:create', 'up']) {
    execFileSync(tsNode, ['src/database/migrate.ts', command], { cwd: root, env: process.env, stdio: 'pipe' });
  }
}
