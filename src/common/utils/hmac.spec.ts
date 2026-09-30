import { hmacSha256, timingSafeEqualHex } from './hmac';

describe('hmac', () => {
  it('hmacSha256 is deterministic 64-hex and never equals input', () => {
    const h = hmacSha256('secret', '123456');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hmacSha256('secret', '123456'));
    expect(h).not.toBe(hmacSha256('other', '123456'));
    expect(h).not.toContain('123456');
  });

  it('timingSafeEqualHex', () => {
    expect(timingSafeEqualHex('abcd', 'abcd')).toBe(true);
    expect(timingSafeEqualHex('abcd', 'abce')).toBe(false);
    expect(timingSafeEqualHex('abcd', 'abc')).toBe(false);
  });
});
