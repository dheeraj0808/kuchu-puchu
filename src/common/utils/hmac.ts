import { createHmac, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256 as 64 hex chars. Used for OTPs, refresh tokens and identifier lookups (guide S2). */
export function hmacSha256(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of two hex strings. When lengths differ a dummy
 * comparison is still performed so timing does not leak the mismatch reason.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
