import { redisKey } from '../infra/redis/redis-keys';

/** guide M07: one export per user per 24 h. */
export const EXPORT_REQUEST_WINDOW_MS = 24 * 60 * 60_000;
/** Failed builds do not count against the daily export, up to this many per 24 h. */
export const EXPORT_MAX_FAILED_PER_WINDOW = 3;
/** guide M07: a built export can be downloaded for 24 h. */
export const EXPORT_LINK_LIFETIME_MS = 24 * 60 * 60_000;
/** Presigned download URLs are valid this long and made anew on every GET. */
export const EXPORT_URL_TTL_SECONDS = 15 * 60;
/** The deletion confirmation address is kept this long for the account.deleted handler. */
export const DELETION_MAIL_TTL_SECONDS = 24 * 60 * 60;

export const STORE_SUBSCRIPTION_NOTICE =
  'Subscriptions bought through Google Play or the App Store are not cancelled by deleting your account. Cancel them in the store to stop being charged.';

export function exportFileKey(requestId: string): string {
  return `exports/${requestId}.zip`;
}

/** Purpose label of the AES-GCM key (derived from OTP_HASH_SECRET) that seals the address in Redis. */
export const DELETION_MAIL_KEY_PURPOSE = 'deletion-mail';

/** The address to confirm a deletion to, sealed; written before the scrub, read and deleted by the account.deleted handler. */
export function deletionMailKey(userId: string): string {
  return redisKey('deletion-mail', userId);
}
