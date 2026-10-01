import { deriveKey, open, seal } from './sealed-box';

describe('sealed box', () => {
  const key = deriveKey('a-secret-of-at-least-32-characters!!', 'deletion-mail');

  it('round-trips, never contains the plaintext, and differs every time', () => {
    const a = seal(key, 'jane@example.com');
    expect(a).not.toContain('jane');
    expect(seal(key, 'jane@example.com')).not.toBe(a);
    expect(open(key, a)).toBe('jane@example.com');
  });

  it('another purpose, a tampered value or garbage → null', () => {
    const sealed = seal(key, 'jane@example.com');
    expect(open(deriveKey('a-secret-of-at-least-32-characters!!', 'other'), sealed)).toBeNull();
    const flipped = Buffer.from(sealed, 'base64url');
    flipped[flipped.length - 1] ^= 1;
    expect(open(key, flipped.toString('base64url'))).toBeNull();
    expect(open(key, 'jane@example.com')).toBeNull();
  });

  it('a value sealed for one context (user) does not open for another', () => {
    const sealed = seal(key, 'jane@example.com', 'user-1');
    expect(open(key, sealed, 'user-1')).toBe('jane@example.com');
    expect(open(key, sealed, 'user-2')).toBeNull();
    expect(open(key, sealed)).toBeNull();
  });
});
