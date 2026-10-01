import { randomUUID } from 'node:crypto';

import type { Redis } from 'ioredis';

/**
 * Uses the Redis server clock, so instances with skewed clocks share one
 * window (TIME before a write needs Redis 5+, which replicates effects). Drop entries older than the window; if `limit` remain, report the oldest
 * one's time; otherwise add this request. One script, so parallel requests
 * on any number of instances can never both take the last slot.
 */
const TAKE_SLOT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
if redis.call('ZCARD', KEYS[1]) >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, tostring(now), oldest[2] or tostring(now)}
end
redis.call('ZADD', KEYS[1], now, ARGV[3])
redis.call('PEXPIRE', KEYS[1], window)
return {1, tostring(now), '0'}`;

export type WindowSlot =
  | { taken: true; release: () => Promise<void> }
  | { taken: false; retryAfterSeconds: number };

/**
 * A sliding-window counter in a Redis sorted set: at most `limit` slots per
 * `windowMs`. A refused take reports when the oldest slot ages out. A taken
 * slot can be handed back with release() (for example when a later check
 * refuses the request).
 */
export async function takeWindowSlot(redis: Redis, key: string, limit: number, windowMs: number): Promise<WindowSlot> {
  const member = randomUUID();
  const [taken, nowRaw, oldest] = (await redis.eval(TAKE_SLOT, 1, key, windowMs, limit, member)) as [number, string, string];
  const now = Number(nowRaw);
  if (taken === 1) {
    return {
      taken: true,
      release: async () => {
        await redis.zrem(key, member).catch(() => undefined);
      },
    };
  }
  const freesAt = Number(oldest) + windowMs;
  return { taken: false, retryAfterSeconds: Math.max(1, Math.ceil((freesAt - now) / 1000)) };
}
