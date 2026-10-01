import { Writable } from 'node:stream';

import type { LoggerService } from '@nestjs/common';

/**
 * Suite-wide log capture for the "no PII in logs" scan (guide Appendix E).
 * Everything the test process logs lands here: pino (the app's request and
 * application logs, see createTestApp), Nest's static Logger, console and raw
 * stdout/stderr. log-scan.ts checks it after every test file.
 */
interface CaptureState {
  lines: string[];
  /** Plaintext values that must never appear: every OTP and identifier handed to a fake provider. */
  secrets: Set<string>;
}

const g = globalThis as typeof globalThis & { __KP_LOG_CAPTURE__?: CaptureState };
export const capture: CaptureState = (g.__KP_LOG_CAPTURE__ ??= { lines: [], secrets: new Set() });

export function recordLine(line: string): void {
  if (line.trim() !== '') capture.lines.push(line);
}

export function rememberSecret(value: string): void {
  if (value) capture.secrets.add(value);
}

/** A pino destination that keeps every line. */
export function captureStream(): Writable {
  return new Writable({
    write(chunk: Buffer, _enc, done): void {
      for (const line of chunk.toString('utf8').split('\n')) recordLine(line);
      done();
    },
  });
}

function stringify(value: unknown): string {
  if (value instanceof Error) return JSON.stringify({ name: value.name, message: value.message, stack: value.stack });
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Nest's static Logger (services built by hand, Logger before the app logger exists). */
export class CaptureLogger implements LoggerService {
  private push(level: string, message: unknown, params: unknown[]): void {
    recordLine(JSON.stringify({ level, message: stringify(message), params: params.map(stringify) }));
  }
  log(message: unknown, ...params: unknown[]): void {
    this.push('log', message, params);
  }
  error(message: unknown, ...params: unknown[]): void {
    this.push('error', message, params);
  }
  warn(message: unknown, ...params: unknown[]): void {
    this.push('warn', message, params);
  }
  debug(message: unknown, ...params: unknown[]): void {
    this.push('debug', message, params);
  }
  verbose(message: unknown, ...params: unknown[]): void {
    this.push('verbose', message, params);
  }
  fatal(message: unknown, ...params: unknown[]): void {
    this.push('fatal', message, params);
  }
}

/** Fields that are numbers by nature and could collide with a 6-digit code. */
const NOISE_KEYS = ['pid', 'time', 'hostname', 'responseTime', 'timestamp'];

const PATTERNS: Array<[string, RegExp]> = [
  ['jwt', /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['refresh token', /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{64}/i],
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  ['phone', /\+[1-9]\d{9,14}/],
];

function denoise(line: string): string {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      for (const key of NOISE_KEYS) delete parsed[key];
      return JSON.stringify(parsed);
    }
  } catch {
    // not JSON
  }
  return line;
}

export interface Leak {
  kind: string;
  /** The offending line, with the secret itself replaced, so the report does not leak it again. */
  line: string;
}

export function scanLines(lines: readonly string[], secrets: ReadonlySet<string>): Leak[] {
  const leaks: Leak[] = [];
  for (const raw of lines) {
    const line = denoise(raw);
    for (const [kind, re] of PATTERNS) {
      if (re.test(line)) leaks.push({ kind, line: line.replace(new RegExp(re, 'g'), `<${kind}>`).slice(0, 300) });
    }
    for (const secret of secrets) {
      const re = new RegExp(`(^|[^0-9A-Za-z])${secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^0-9A-Za-z])`);
      if (re.test(line)) leaks.push({ kind: 'otp or identifier', line: line.split(secret).join('<secret>').slice(0, 300) });
    }
  }
  return leaks;
}
