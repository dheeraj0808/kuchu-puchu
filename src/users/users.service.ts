import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import type { Redis } from 'ioredis';
import { UniqueConstraintError, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import { IdentifierType } from '../auth/models/otp-verification.model';
import { SessionStateService } from '../auth/session-state/session-state.service';
import { normalizeIdentifierStrict } from '../auth/utils/identifier.util';
import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import { OutboxService } from '../events/outbox.service';
import { errorClassOf } from '../infra/alerts/alert.provider';
import { REDIS_CLIENT } from '../infra/redis/redis.module';
import { redisKey } from '../infra/redis/redis-keys';
import { SecurityEventType } from '../security/models/security-event.model';
import { SecurityEventsService } from '../security/security-events.service';
import { User, UserStatus } from './models/user.model';
import { UserResponseDto } from './dto/user-response.dto';

/** Guide M04: last_active_at is written at most once per 5 minutes per user. */
export const LAST_ACTIVE_THROTTLE_SECONDS = 300;

/** Status-change reasons are codes, never free text (they go into audit metadata). */
const REASON = /^[a-z0-9_.]{1,64}$/;

export interface SetStatusOptions {
  /** Required with `suspended`, and must be in the future. */
  until?: Date;
  actorUserId?: string;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectConnection() private readonly sequelize: Sequelize,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly outbox: OutboxService,
    private readonly securityEvents: SecurityEventsService,
    private readonly sessionState: SessionStateService,
  ) {}

  findById(id: string, transaction?: Transaction): Promise<User | null> {
    return this.userModel.findByPk(id, { transaction });
  }

  /** The identifier is normalised first (lower-cased email, E.164 phone); an invalid phone → 400. */
  async findByIdentifier(type: IdentifierType, identifier: string, transaction?: Transaction): Promise<User | null> {
    return this.userModel.findOne({ where: this.identifierWhere(type, identifier), transaction });
  }

  /**
   * Inserts a verified user. If another request inserted the same identifier
   * first (unique-key race), returns that user instead. The re-read is a
   * locking read, so it sees the winner's committed row even inside a
   * REPEATABLE READ transaction whose snapshot predates it.
   */
  async createVerified(
    type: IdentifierType,
    identifier: string,
    transaction?: Transaction,
  ): Promise<{ user: User; created: boolean }> {
    const value = normalizeIdentifierStrict(type, identifier);
    const now = new Date();
    const attrs =
      type === IdentifierType.Email ? { email: value, emailVerifiedAt: now } : { phone: value, phoneVerifiedAt: now };
    try {
      return { user: await this.userModel.create({ ...attrs, lastLoginAt: now }, { transaction }), created: true };
    } catch (err) {
      if (!(err instanceof UniqueConstraintError)) throw err;
      const existing = await this.userModel.findOne({
        where: this.identifierWhere(type, value),
        transaction,
        ...(transaction ? { lock: transaction.LOCK.SHARE } : {}),
      });
      if (!existing) throw err;
      return { user: existing, created: false };
    }
  }

  /** Row-locks the user for the duration of the transaction. */
  findByIdForUpdate(id: string, transaction: Transaction): Promise<User | null> {
    return this.userModel.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
  }

  /**
   * Changes the account status (guide M04; used by moderation, M15). One
   * transaction updates the user, publishes user.status_changed through the
   * outbox and records a security event. The cached session state is dropped
   * after the commit, so the next request already sees the new status; the
   * users.revoke_sessions handler then revokes the sessions.
   */
  async setStatus(
    userId: string,
    status: UserStatus,
    reason: string,
    options: SetStatusOptions = {},
  ): Promise<User> {
    if (!REASON.test(reason)) throw new Error('setStatus reason must be a code matching [a-z0-9_.]{1,64}');
    if (status === UserStatus.Suspended && !(options.until && options.until.getTime() > Date.now())) {
      throw new Error('setStatus(suspended) needs a future `until`');
    }
    const user = await this.sequelize.transaction(async (transaction) => {
      const found = await this.findByIdForUpdate(userId, transaction);
      if (!found) throw new AppException(ErrorCode.UserNotFound);
      const from = found.status;
      const until = status === UserStatus.Suspended ? (options.until as Date) : null;
      // Nothing changes: no event, no audit row.
      if (from === status && (found.suspendedUntil?.getTime() ?? null) === (until?.getTime() ?? null)) return found;
      found.set({
        status,
        suspendedUntil: until,
      });
      await found.save({ transaction });
      await this.outbox.publish('user.status_changed', found.id, { userId: found.id, from, to: status }, transaction);
      await this.securityEvents.record({
        eventType: SecurityEventType.UserStatusChanged,
        userId: found.id,
        actorUserId: options.actorUserId ?? null,
        metadata: {
          from,
          to: status,
          reason,
          ...(status === UserStatus.Suspended ? { until: (options.until as Date).toISOString() } : {}),
        },
        transaction,
      });
      await this.sessionState.invalidateUser(found.id, transaction);
      return found;
    });
    return user;
  }

  /**
   * Records activity at most once per LAST_ACTIVE_THROTTLE_SECONDS per user:
   * SET kp:active:<userId> NX EX 300, and only when the key was new, update
   * last_active_at. Never throws; errors are logged by class.
   */
  async touchLastActive(userId: string): Promise<boolean> {
    try {
      const set = await this.redis.set(redisKey('active', userId), '1', 'EX', LAST_ACTIVE_THROTTLE_SECONDS, 'NX');
      if (set !== 'OK') return false;
      await this.userModel.update({ lastActiveAt: new Date() }, { where: { id: userId }, silent: true });
      return true;
    } catch (err) {
      this.logger.warn({ err: errorClassOf(err) }, 'Could not record last activity');
      return false;
    }
  }

  /**
   * Account deletion: frees the email/phone for reuse, sets the status to
   * deactivated and soft-deletes the row so audit records keep a valid user
   * reference. (Minimal M04 change; the full rework is M07.)
   */
  async anonymizeAndSoftDelete(user: User, transaction: Transaction): Promise<void> {
    user.set({
      email: null,
      phone: null,
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
      isActive: false,
      status: UserStatus.Deactivated,
    });
    await user.save({ transaction });
    await user.destroy({ transaction });
  }

  toResponse(user: User): UserResponseDto {
    return UserResponseDto.fromModel(user);
  }

  private identifierWhere(type: IdentifierType, identifier: string): { email: string } | { phone: string } {
    const value = normalizeIdentifierStrict(type, identifier);
    return type === IdentifierType.Email ? { email: value } : { phone: value };
  }
}
