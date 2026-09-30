import { AppException, ErrorCode } from '../exceptions/app.exception';
import { type CursorPayload, MAX_CURSOR_LENGTH, decodeCursor, encodeCursor } from './cursor';

function expectInvalid(fn: () => unknown): void {
  try {
    fn();
    fail('expected an invalid cursor error');
  } catch (e) {
    expect(e).toBeInstanceOf(AppException);
    const err = e as AppException;
    expect(err.code).toBe(ErrorCode.ValidationError);
    expect(err.getStatus()).toBe(400);
    expect(err.details).toEqual({ errors: ['cursor is invalid'] });
  }
}

describe('cursor', () => {
  const position = { createdAt: '2026-09-30T10:00:00.000Z', id: '01926b7e-0000-7000-8000-000000000001' };

  it('round-trips a keyset position', () => {
    const cursor = encodeCursor(position);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, safe in a query string
    expect(decodeCursor(cursor)).toEqual(position);
  });

  it('is base64url of the JSON', () => {
    expect(JSON.parse(Buffer.from(encodeCursor({ n: 1 }), 'base64url').toString())).toEqual({ n: 1 });
  });

  it('applies an optional shape check', () => {
    const isPosition = (p: CursorPayload): p is { createdAt: string; id: string } =>
      typeof p.createdAt === 'string' && typeof p.id === 'string';
    expect(decodeCursor(encodeCursor(position), isPosition).id).toBe(position.id);
    expectInvalid(() => decodeCursor(encodeCursor({ id: 5 }), isPosition));
  });

  it.each([
    ['empty', ''],
    ['not base64url', 'abc$%^'],
    ['base64 with padding', `${Buffer.from('{}').toString('base64')}==`],
    ['not JSON', Buffer.from('not json').toString('base64url')],
    ['a JSON array', encodeCursorRaw('[1,2]')],
    ['a JSON string', encodeCursorRaw('"x"')],
    ['JSON null', encodeCursorRaw('null')],
    ['a nested object', encodeCursorRaw('{"a":{"b":1}}')],
    ['too long', 'a'.repeat(MAX_CURSOR_LENGTH + 1)],
  ])('rejects a cursor that is %s with 400 VALIDATION_ERROR', (_label, cursor) => {
    expectInvalid(() => decodeCursor(cursor));
  });
});

function encodeCursorRaw(json: string): string {
  return Buffer.from(json, 'utf8').toString('base64url');
}
