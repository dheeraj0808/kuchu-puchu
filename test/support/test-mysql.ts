import { randomBytes } from 'node:crypto';

import { TEST_DB_NAME } from './test-env';

interface StartedMysql {
  source: 'testcontainers' | 'env';
  stop: () => Promise<void>;
}

/**
 * Where tests get MySQL from:
 *  - CI (CI=true) or TEST_MYSQL_CONTAINER=1: a throwaway Testcontainers
 *    MySQL 8.4 with utf8mb4_0900_ai_ci. Its connection details replace
 *    DB_HOST / DB_PORT / DB_USER / DB_PASSWORD for the whole run.
 *  - Otherwise: the server in .env (local MySQL 8.4 on port 3307), always
 *    with the dedicated _test database (see test-env.ts).
 */
export async function startTestMysql(): Promise<StartedMysql> {
  if (!process.env.CI && process.env.TEST_MYSQL_CONTAINER !== '1') {
    return { source: 'env', stop: async () => undefined };
  }
  const { MySqlContainer } = await import('@testcontainers/mysql');
  const container = await new MySqlContainer('mysql:8.4')
    .withDatabase(TEST_DB_NAME)
    .withUsername('kuchu_puchu')
    .withUserPassword(randomBytes(18).toString('base64url'))
    .withCommand(['--character-set-server=utf8mb4', '--collation-server=utf8mb4_0900_ai_ci', '--default-time-zone=+00:00'])
    .start();
  process.env.DB_HOST = container.getHost();
  process.env.DB_PORT = String(container.getPort());
  process.env.DB_USER = container.getUsername();
  process.env.DB_PASSWORD = container.getUserPassword();
  return {
    source: 'testcontainers',
    stop: async () => {
      await container.stop();
    },
  };
}
