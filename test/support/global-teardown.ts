type GlobalWithRedis = typeof globalThis & { __TEST_REDIS_STOP__?: () => Promise<void> };

/** Stops the Testcontainers Redis, if one was started. */
export default async function globalTeardown(): Promise<void> {
  await (globalThis as GlobalWithRedis).__TEST_REDIS_STOP__?.();
}
