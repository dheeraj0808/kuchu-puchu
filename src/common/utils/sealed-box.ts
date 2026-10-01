import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for short secrets kept for a while outside MySQL (e.g. the
 * deletion confirmation address in Redis). The key is derived from a config
 * secret with a purpose label, so each use gets its own key without another
 * env variable. Output: base64url(iv | tag | ciphertext).
 */
export function deriveKey(secret: string, purpose: string): Buffer {
  return createHmac('sha256', secret).update(`key:${purpose}`).digest();
}

/** `context` (e.g. the user id) is bound as associated data: the value only opens with the same context. */
export function seal(key: Buffer, plaintext: string, context = ''): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** null when the value was not sealed with this key or was tampered with. */
export function open(key: Buffer, sealed: string, context = ''): string | null {
  try {
    const raw = Buffer.from(sealed, 'base64url');
    if (raw.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
