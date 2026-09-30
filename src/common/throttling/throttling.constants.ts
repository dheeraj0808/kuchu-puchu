/** Per-IP throttler. Keeps the name 'default' so existing @Throttle({ default }) overrides apply. */
export const THROTTLER_IP = 'default';
/** Per-user throttler, keyed by the authenticated user id. */
export const THROTTLER_USER = 'user';

/** Guide M01 default: 100 requests / 60 s per IP. */
export const IP_LIMIT = { limit: 100, ttl: 60_000 };
/**
 * Default per-user budget across all routes. Write endpoints set tighter
 * limits with @Throttle({ user: { limit, ttl } }) as their modules are built.
 */
export const USER_LIMIT = { limit: 100, ttl: 60_000 };

/** Use on routes that must never be rate limited (health checks). */
export const SKIP_ALL_THROTTLERS = { [THROTTLER_IP]: true, [THROTTLER_USER]: true };
