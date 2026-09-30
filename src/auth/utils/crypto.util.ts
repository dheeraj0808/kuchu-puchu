import { randomBytes, randomInt } from 'node:crypto';

/**
 * Generates a uniformly distributed numeric OTP of `length` digits using a
 * CSPRNG. Leading zeros are preserved.
 */
export function generateNumericOtp(length: number): string {
  if (!Number.isInteger(length) || length < 4 || length > 10) {
    throw new Error('OTP length must be an integer between 4 and 10');
  }
  let out = '';
  for (let i = 0; i < length; i++) {
    out += randomInt(0, 10).toString();
  }
  return out.padStart(length, '0');
}

/** 48 random bytes, base64url encoded (64 chars). */
export function generateTokenSecret(): string {
  return randomBytes(48).toString('base64url');
}

const DURATION_UNITS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

/** Parses '30s' | '15m' | '12h' | '7d' | '3600' into seconds. */
export function parseDuration(value: string | number): number {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error('Invalid duration');
    }
    return value;
  }
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2] ?? 's';
  const seconds = amount * DURATION_UNITS[unit];
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new Error(`Invalid duration: ${value}`);
  }
  return seconds;
}
