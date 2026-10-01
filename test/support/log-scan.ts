import { appendFileSync } from 'node:fs';
import { format } from 'node:util';

import { Logger } from '@nestjs/common';

import { capture, CaptureLogger, recordLine, scanLines } from './log-capture';

/**
 * Runs in every integration / e2e test file (setupFilesAfterEnv). Routes every
 * log path of the test process into the capture, then fails the file if any
 * line contains an OTP or identifier sent through a fake provider, a JWT, a
 * refresh token, an email address or a phone number.
 */
Logger.overrideLogger(new CaptureLogger());

for (const stream of [process.stdout, process.stderr]) {
  const original = stream.write.bind(stream) as (...args: unknown[]) => boolean;
  stream.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
    for (const line of String(chunk).split('\n')) recordLine(line);
    return original(chunk, ...rest);
  }) as typeof stream.write;
}
for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]): void => {
    recordLine(format(...args));
    original(...args);
  };
}

const start = capture.lines.length;

afterAll(() => {
  const lines = capture.lines.slice(start);
  const leaks = scanLines(lines, capture.secrets);
  const file = process.env.TEST_LOG_SCAN_REPORT;
  if (file) appendFileSync(file, `${JSON.stringify({ test: expect.getState().testPath, lines: lines.length, leaks: leaks.length })}\n`);
  expect(leaks).toEqual([]);
});
