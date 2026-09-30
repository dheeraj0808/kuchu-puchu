type GlobalWithContainers = typeof globalThis & { __TEST_CONTAINERS_STOP__?: Array<() => Promise<void>> };

/** Stops any Testcontainers started by global-setup.ts. */
export default async function globalTeardown(): Promise<void> {
  await Promise.all(((globalThis as GlobalWithContainers).__TEST_CONTAINERS_STOP__ ?? []).map((stop) => stop()));
}
