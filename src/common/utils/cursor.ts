import { AppException, ErrorCode } from '../exceptions/app.exception';

/** Guide §4.1: keyset pagination with an opaque cursor. */
export type CursorPayload = Record<string, string | number | boolean | null>;

/** Longest cursor accepted; real cursors are a few ids and timestamps. */
export const MAX_CURSOR_LENGTH = 512;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function invalidCursor(): AppException {
  return new AppException(ErrorCode.ValidationError, { errors: ['cursor is invalid'] });
}

/** Encodes a flat keyset position (e.g. `{ createdAt, id }`) as base64url JSON. */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decodes a cursor from `?cursor=`. Anything that is not base64url JSON of a
 * flat object with primitive values (or fails `isValid`) is a 400
 * VALIDATION_ERROR, never a 500.
 */
export function decodeCursor<T extends CursorPayload = CursorPayload>(
  cursor: string,
  isValid?: (payload: CursorPayload) => payload is T,
): T {
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH || !BASE64URL.test(cursor)) {
    throw invalidCursor();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw invalidCursor();
  const flat = Object.values(parsed).every(
    (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v),
  );
  if (!flat) throw invalidCursor();
  const payload = parsed as CursorPayload;
  if (isValid && !isValid(payload)) throw invalidCursor();
  return payload as T;
}
