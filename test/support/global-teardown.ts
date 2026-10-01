import { existsSync, readFileSync, rmSync } from 'node:fs';

type GlobalWithContainers = typeof globalThis & { __TEST_CONTAINERS_STOP__?: Array<() => Promise<void>> };

/** Prints the log-scan total, then stops any Testcontainers started by global-setup.ts. */
export default async function globalTeardown(): Promise<void> {
  const report = process.env.TEST_LOG_SCAN_REPORT;
  if (report && existsSync(report)) {
    const rows = readFileSync(report, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { lines: number; leaks: number });
    const lines = rows.reduce((n, r) => n + r.lines, 0);
    const leaks = rows.reduce((n, r) => n + r.leaks, 0);
    console.log(`[log-scan] ${rows.length} test files, ${lines} log lines scanned, ${leaks} with an OTP, token, phone or email`);
    rmSync(report, { force: true });
  }
  await Promise.all(((globalThis as GlobalWithContainers).__TEST_CONTAINERS_STOP__ ?? []).map((stop) => stop()));
}
