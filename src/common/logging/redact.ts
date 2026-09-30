export const REDACTED = '[REDACTED]';

/**
 * Keys whose values never reach logs or Sentry, at any depth (guide §4.4:
 * never log OTPs, tokens, phone numbers or emails). Matched case-insensitively.
 * Same fields as the pino redact paths before M01 Part C, now applied deeply.
 */
export const SENSITIVE_KEYS: readonly string[] = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'otp',
  'code',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'identifier',
  'email',
  'phone',
];

const SENSITIVE = new Set(SENSITIVE_KEYS.map((k) => k.toLowerCase()));
const MAX_DEPTH = 12;

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

/**
 * Returns a copy of `value` with sensitive keys replaced by "[REDACTED]" at
 * any depth. Plain objects, arrays and Errors (including their own props,
 * e.g. `details`) are walked; other class instances (streams, sockets, the
 * raw request) are left untouched for pino's serializers and redact paths.
 * Cycles and very deep nesting are cut off safely.
 */
export function redactDeep<T>(value: T, depth = 0, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]' as T;
  if (depth >= MAX_DEPTH) return '[Truncated]' as T;

  if (Array.isArray(value)) {
    seen.add(value);
    return value.map((item: unknown) => redactDeep(item, depth + 1, seen)) as T;
  }

  if (value instanceof Error) {
    seen.add(value);
    const copy = Object.create(Object.getPrototypeOf(value) as object) as Record<string, unknown>;
    copy.name = value.name;
    copy.message = value.message;
    copy.stack = value.stack;
    for (const [key, v] of Object.entries(value)) {
      copy[key] = SENSITIVE.has(key.toLowerCase()) ? REDACTED : redactDeep(v, depth + 1, seen);
    }
    return copy as T;
  }

  if (!isPlainObject(value)) return value;
  seen.add(value);
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE.has(key.toLowerCase()) ? REDACTED : redactDeep(v, depth + 1, seen);
  }
  return out as T;
}
