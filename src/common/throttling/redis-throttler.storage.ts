import { Inject, Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../infra/redis/redis.module';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Fixed-window counter plus a block key, updated atomically in one script so
 * concurrent requests on different instances can never over-admit.
 * KEYS[1] = hits key, KEYS[2] = block key
 * ARGV[1] = ttl ms, ARGV[2] = limit, ARGV[3] = block duration ms
 * Returns { hits, hitsTtlMs, blocked (0|1), blockTtlMs }.
 */
const INCREMENT_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  return { hits, redis.call('PTTL', KEYS[1]), 1, blockTtl }
end
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return { hits, ttl, 1, tonumber(ARGV[3]) }
end
return { hits, ttl, 0, 0 }
`;

const toSeconds = (ms: number): number => Math.max(0, Math.ceil(ms / 1000));

/** Rate-limit counters in Redis, so limits hold across every API instance (guide S4). */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const [hits, hitsTtlMs, blocked, blockTtlMs] = (await this.redis.eval(
      INCREMENT_SCRIPT,
      2,
      key,
      `${key}:block`,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number, number];
    return {
      totalHits: hits,
      timeToExpire: toSeconds(hitsTtlMs),
      isBlocked: blocked === 1,
      timeToBlockExpire: toSeconds(blockTtlMs),
    };
  }
}
