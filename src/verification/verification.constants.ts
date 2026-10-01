/** The approved (or reviewed / rejected) selfie in the private bucket. No user id in the key. */
export const selfieKey = (verificationId: string): string => `v/${verificationId}.webp`;

/** Rolling window of the daily attempt quota. */
export const ATTEMPT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Per-user HTTP limits on top of the attempt quota (guide S4). */
export const SESSION_CREATE_LIMIT = { limit: 10, ttl: 60 * 60 * 1000 };
export const SESSION_COMPLETE_LIMIT = { limit: 20, ttl: 60 * 60 * 1000 };

/** Stored on anonymised rows in place of the provider's session id (NOT NULL column). */
export const ANONYMISED_PROVIDER_SESSION_ID = 'anonymised';

/** Rows per batch in the periodic jobs. */
export const VERIFICATION_JOB_BATCH = 500;

/** Appendix B schedules (UTC). */
export const FACE_SESSION_EXPIRY_SCHEDULE = { pattern: '23 * * * *' };
/** 22:00 UTC is 03:30 IST. */
export const SELFIE_RETENTION_SCHEDULE = { pattern: '0 22 * * *' };
export const SELFIE_PURGE_SCHEDULE = { pattern: '*/15 * * * *' };

/**
 * Score bucket for audit events: the decade only (e.g. "80-89"), never
 * the exact provider score.
 */
export function scoreBucket(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 100) return '100';
  const low = Math.max(0, Math.floor(score / 10) * 10);
  return `${low}-${low + 9}`;
}
