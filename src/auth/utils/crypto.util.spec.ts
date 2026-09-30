import 'reflect-metadata';
import * as crypto from 'node:crypto';

import {
  generateNumericOtp,
  generateTokenSecret,
  hmacSha256,
  parseDuration,
  timingSafeEqualHex,
} from './crypto.util';
import { maskEmail, maskPhone } from './mask.util';

jest.mock('node:crypto', () => {
  const actual = jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { ...actual, randomInt: jest.fn(actual.randomInt) };
});

describe('crypto.util', () => {
  describe('generateNumericOtp', () => {
    it.each([4, 6, 8, 10])('generates %i digits only', (len) => {
      for (let i = 0; i < 50; i++) {
        const otp = generateNumericOtp(len);
        expect(otp).toHaveLength(len);
        expect(otp).toMatch(/^\d+$/);
      }
    });

    it('uses crypto.randomInt and keeps leading zeros', () => {
      const randomInt = crypto.randomInt as unknown as jest.Mock;
      randomInt.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(7);
      randomInt.mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValueOnce(3);
      expect(generateNumericOtp(6)).toBe('007123');
      expect(randomInt).toHaveBeenCalledWith(0, 10);
    });

    it('is not trivially repeating', () => {
      const set = new Set(Array.from({ length: 200 }, () => generateNumericOtp(6)));
      expect(set.size).toBeGreaterThan(190);
    });

    it('rejects invalid lengths', () => {
      expect(() => generateNumericOtp(3)).toThrow();
      expect(() => generateNumericOtp(11)).toThrow();
    });
  });

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

  it('generateTokenSecret yields 64-char base64url unique values', () => {
    const a = generateTokenSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(a).not.toBe(generateTokenSecret());
  });

  it('parseDuration', () => {
    expect(parseDuration('15m')).toBe(900);
    expect(parseDuration('7d')).toBe(604800);
    expect(parseDuration('3600')).toBe(3600);
    expect(parseDuration('30s')).toBe(30);
    expect(parseDuration('12h')).toBe(43200);
    expect(() => parseDuration('abc')).toThrow();
    expect(() => parseDuration('0')).toThrow();
    expect(() => parseDuration('5w')).toThrow();
  });

  it('masks identifiers', () => {
    expect(maskEmail('jane@example.com')).toBe('j***@example.com');
    expect(maskPhone('+919876543210')).toBe('+91******3210');
  });
});
