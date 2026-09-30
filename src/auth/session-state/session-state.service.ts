import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import type { Redis } from 'ioredis';
import { QueryTypes, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import { errorClassOf } from '../../infra/alerts/alert.provider';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { redisKey } from '../../infra/redis/redis-keys';
import {
  canAuthenticate,
  type UserRole,
  type UserStatus,
} from '../../users/models/user.model';

/** Guide S3 / M04: session state is cached for 5 minutes and deleted on every change. */
export const SESSION_CACHE_TTL_SECONDS = 300;

export const RESTRICTED_REVOKE_REASON = 'restricted';

/** What the JWT check needs per request. Never contains tokens or identifiers. */
export interface SessionState {
  userId: string;
  role: UserRole;
  status: UserStatus;
  deleted: boolean;
  revoked: boolean;
  /** ms since epoch */
  expiresAt: number;
}

export function sessionCacheKey(sessionId: string): string {
  return redisKey('session', sessionId);
}

/** Bumped on every invalidation, so a read that started before it never re-caches old state. */
export function sessionVersionKey(sessionId: string): string {
  return redisKey('session-ver', sessionId);
}

/** SET the state only if the version is still the one read before the DB load. */
const SET_IF_VERSION = `
local current = redis.call('GET', KEYS[2]) or ''
if current ~= ARGV[3] then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 1`;

export function stateCanAuthenticate(state: SessionState): boolean {
  return canAuthenticate({
    status: state.status,
    deletedAt: state.deleted ? new Date(0) : null,
  });
}

interface Row {
  user_id: string;
  revoked_at: Date | null;
  expires_at: Date;
  role: UserRole | null;
  status: UserStatus | null;
  deleted_at: Date | null;
}

/**
 * The session cache (kp:session:<sessionId>) and the operations that must
 * keep it correct. Owned by auth; also used by users (status changes) and by
 * the worker's revoke handler, so it depends on nothing but MySQL and Redis.
 * Redis failures fall back to MySQL and are logged by error class only.
 */
@Injectable()
export class SessionStateService {
  private readonly logger = new Logger(SessionStateService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /** Cached state, or the database's (then cached). null when the session or its user does not exist. */
  async get(sessionId: string): Promise<SessionState | null> {
    const key = sessionCacheKey(sessionId);
    let version: string | null = null;
    let redisUp = true;
    try {
      const [raw, v] = await this.redis.mget(key, sessionVersionKey(sessionId));
      if (raw) return JSON.parse(raw) as SessionState;
      version = v ?? '';
    } catch (err) {
      redisUp = false;
      this.logger.warn(
        { err: errorClassOf(err) },
        'Session cache read failed; using the database',
      );
    }
    const state = await this.load(sessionId);
    if (state && redisUp) {
      await this.redis
        .eval(
          SET_IF_VERSION,
          2,
          key,
          sessionVersionKey(sessionId),
          JSON.stringify(state),
          SESSION_CACHE_TTL_SECONDS,
          version ?? '',
        )
        .catch((err: unknown) =>
          this.logger.warn(
            { err: errorClassOf(err) },
            'Session cache write failed',
          ),
        );
    }
    return state;
  }

  /**
   * True at most once per session per cache TTL, so a restricted user
   * retrying in a loop produces one audit event, not one per request.
   * Redis down → true (auditing wins over deduplication).
   */
  async takeRestrictionAuditSlot(sessionId: string): Promise<boolean> {
    try {
      const set = await this.redis.set(redisKey('restricted-audit', sessionId), '1', 'EX', SESSION_CACHE_TTL_SECONDS, 'NX');
      return set === 'OK';
    } catch {
      return true;
    }
  }

  /** Deletes cached state now, or after the transaction commits when one is given. */
  async invalidate(
    sessionIds: string[],
    transaction?: Transaction,
  ): Promise<void> {
    if (sessionIds.length === 0) return;
    const run = async (): Promise<void> => {
      try {
        const multi = this.redis.multi();
        for (const id of sessionIds) {
          multi.del(sessionCacheKey(id));
          // A load that started before this can no longer write its (old) result.
          multi.incr(sessionVersionKey(id));
          multi.expire(sessionVersionKey(id), SESSION_CACHE_TTL_SECONDS * 2);
        }
        await multi.exec();
      } catch (err) {
        this.logger.error(
          { err: errorClassOf(err) },
          'Session cache delete failed',
        );
      }
    };
    if (transaction) {
      // Deleting before the commit would let a concurrent request re-cache the old state.
      // Sequelize awaits afterCommit hooks, so the caller returns only once the keys are gone.
      transaction.afterCommit(() => run());
      return;
    }
    await run();
  }

  /** Deletes the cached state of every session of the user that could still be cached. */
  async invalidateUser(
    userId: string,
    transaction?: Transaction,
  ): Promise<void> {
    const run = async (): Promise<void> => {
      const rows = await this.sequelize.query<{ id: string }>(
        `SELECT id FROM sessions
          WHERE user_id = :userId
            AND (revoked_at IS NULL OR revoked_at > NOW(3) - INTERVAL :ttl SECOND)`,
        {
          replacements: { userId, ttl: SESSION_CACHE_TTL_SECONDS * 2 },
          type: QueryTypes.SELECT,
        },
      );
      await this.invalidate(rows.map((r) => r.id));
    };
    const safeRun = (): Promise<void> =>
      run().catch((err: unknown) =>
        this.logger.error(
          { err: errorClassOf(err) },
          'Session cache invalidation failed',
        ),
      );
    if (transaction) {
      transaction.afterCommit(() => safeRun());
      return;
    }
    await safeRun();
  }

  /**
   * Revokes every open session of the user with reason "restricted" and drops
   * their cache. Idempotent: a second call revokes nothing and returns 0.
   */
  async revokeAllForRestriction(userId: string): Promise<number> {
    const affected = await this.sequelize.query(
      `UPDATE sessions SET revoked_at = NOW(3), revoked_reason = :reason
        WHERE user_id = :userId AND revoked_at IS NULL`,
      {
        replacements: { userId, reason: RESTRICTED_REVOKE_REASON },
        type: QueryTypes.BULKUPDATE,
      },
    );
    await this.invalidateUser(userId);
    return affected;
  }

  private async load(sessionId: string): Promise<SessionState | null> {
    const [row] = await this.sequelize.query<Row>(
      `SELECT s.user_id, s.revoked_at, s.expires_at, u.role, u.status, u.deleted_at
         FROM sessions s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.id = :sessionId`,
      { replacements: { sessionId }, type: QueryTypes.SELECT },
    );
    if (!row || !row.role || !row.status) return null;
    return {
      userId: row.user_id,
      role: row.role,
      status: row.status,
      deleted: row.deleted_at !== null,
      revoked: row.revoked_at !== null,
      expiresAt: new Date(row.expires_at).getTime(),
    };
  }
}

@Module({ providers: [SessionStateService], exports: [SessionStateService] })
export class SessionStateModule {}
