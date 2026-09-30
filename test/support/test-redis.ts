import { Redis } from 'ioredis';

/**
 * Where tests get Redis from, in order:
 *  1. TEST_REDIS_URL, if set (must name a DB index other than 0).
 *  2. A throwaway Testcontainers Redis 7. CI (CI=true) requires this path.
 *  3. Locally without Docker: the local server (REDIS_URL or localhost:6379),
 *     always on DB index 15 so dev data in DB 0 is never touched.
 *
 * Cleanup deletes only keys under the app's `kp:` prefix via SCAN.
 * FLUSHALL / FLUSHDB are never used.
 */
export const LOCAL_TEST_REDIS_DB = 15;
const DISPOSABLE_FLAG = 'TEST_REDIS_DISPOSABLE';

interface StartedRedis {
  url: string;
  source: 'TEST_REDIS_URL' | 'testcontainers' | 'local-db15';
  stop: () => Promise<void>;
}

function dbIndexOf(url: string): number {
  const path = new URL(url).pathname.replace('/', '');
  return path === '' ? 0 : Number.parseInt(path, 10);
}

export function withDbIndex(url: string, db: number): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

export async function startTestRedis(): Promise<StartedRedis> {
  const explicit = process.env.TEST_REDIS_URL;
  if (explicit) {
    if (dbIndexOf(explicit) === 0) {
      throw new Error('TEST_REDIS_URL must use a dedicated DB index (e.g. redis://localhost:6379/15), not 0');
    }
    return { url: explicit, source: 'TEST_REDIS_URL', stop: async () => undefined };
  }

  try {
    const { RedisContainer } = await import('@testcontainers/redis');
    const container = await new RedisContainer('redis:7-alpine').start();
    process.env[DISPOSABLE_FLAG] = '1';
    return {
      url: container.getConnectionUrl(),
      source: 'testcontainers',
      stop: async () => {
        await container.stop();
      },
    };
  } catch (err) {
    if (process.env.CI) {
      throw new Error(`Testcontainers Redis is required in CI: ${(err as Error).message}`);
    }
  }

  const local = withDbIndex(process.env.REDIS_URL ?? 'redis://localhost:6379', LOCAL_TEST_REDIS_DB);
  return { url: local, source: 'local-db15', stop: async () => undefined };
}

/** Deletes this app's keys (kp:*) from the test Redis. Refuses DB 0 on a shared server. */
export async function clearTestKeys(url: string): Promise<void> {
  if (dbIndexOf(url) === 0 && process.env[DISPOSABLE_FLAG] !== '1') {
    throw new Error('Refusing to clear keys in Redis DB 0: tests must use a dedicated DB index or a throwaway container');
  }
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'kp:*', 'COUNT', 500);
      if (keys.length > 0) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  } finally {
    redis.disconnect();
  }
}
