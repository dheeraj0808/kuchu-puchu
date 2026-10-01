import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/sequelize';
import type { Redis } from 'ioredis';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import { IdentifierType } from '../auth/models/otp-verification.model';
import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import type { RequestContext } from '../common/utils/request-context';
import { deriveKey, seal } from '../common/utils/sealed-box';
import type { SecurityConfig } from '../config/security.config';
import { OutboxService } from '../events/outbox.service';
import { errorClassOf } from '../infra/alerts/alert.provider';
import { REDIS_CLIENT } from '../infra/redis/redis.module';
import { SecurityEventType } from '../security/models/security-event.model';
import { SecurityEventsService } from '../security/security-events.service';
import { DELETION_MAIL_KEY_PURPOSE, DELETION_MAIL_TTL_SECONDS, deletionMailKey } from './account.constants';
import { AccountDeletionRegistry } from './registry/account-registry';

interface LockedUser {
  id: string;
  email: string | null;
  phone: string | null;
  status: string;
}

/**
 * Account deletion (guide M07). It knows no module: every module registers an
 * AccountDeletionHandler, and delete() runs them in order in one transaction
 * with the user row locked. Any failure rolls everything back. Side effects
 * (confirmation email, file purges) are outbox events, delivered only after
 * the commit.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly registry: AccountDeletionRegistry,
    private readonly outbox: OutboxService,
    private readonly securityEvents: SecurityEventsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly config: ConfigService,
  ) {}

  /** 404 USER_NOT_FOUND if the user does not exist or is already deleted. */
  async delete(userId: string, ctx?: RequestContext): Promise<void> {
    const mailKey = deletionMailKey(userId);
    let mailKeyWritten = false;
    try {
      await this.sequelize.transaction(async (tx) => {
        const [user] = await this.sequelize.query<LockedUser>(
          'SELECT id, email, phone, status FROM users WHERE id = :userId AND deleted_at IS NULL FOR UPDATE',
          { replacements: { userId }, type: QueryTypes.SELECT, transaction: tx },
        );
        if (!user) throw new AppException(ErrorCode.UserNotFound);

        // The outbox carries ids only: the address waits, sealed, in Redis for the account.deleted handler.
        if (user.email) mailKeyWritten = await this.keepDeletionMail(mailKey, user.email, userId);

        const results: Record<string, Record<string, number | boolean>> = {};
        for (const handler of this.registry.ordered()) {
          const result = await handler.handle(userId, tx);
          if (result) results[handler.name] = result;
        }

        await this.outbox.publish('account.deleted', userId, { userId }, tx);
        await this.securityEvents.record({
          eventType: SecurityEventType.AccountDeleted,
          userId,
          context: ctx,
          metadata: {
            wasBanned: user.status === 'banned',
            // 12-char keyed-hash prefixes only (guide M05), never the identifiers.
            identifierHashPrefixes: [
              ...(user.email ? [this.securityEvents.hashIdentifier(IdentifierType.Email, user.email)] : []),
              ...(user.phone ? [this.securityEvents.hashIdentifier(IdentifierType.Phone, user.phone)] : []),
            ],
            handlers: this.registry.ordered().map((h) => h.name),
            results,
          },
          transaction: tx,
          // Never commit a deletion without its audit row.
          strict: true,
        });
      });
    } catch (err) {
      // Rolled back: no account.deleted event, so nobody would ever read the key.
      if (mailKeyWritten) await this.redis.del(mailKey).catch(() => undefined);
      throw err;
    }
  }

  /** Sealed with AES-256-GCM, never in plain text. Redis down: the deletion still goes ahead, without the email. */
  private async keepDeletionMail(key: string, email: string, userId: string): Promise<boolean> {
    try {
      const secret = this.config.getOrThrow<SecurityConfig>('security').identifierHashSecret;
      await this.redis.set(key, seal(deriveKey(secret, DELETION_MAIL_KEY_PURPOSE), email, userId), 'EX', DELETION_MAIL_TTL_SECONDS);
      return true;
    } catch (err) {
      this.logger.warn({ err: errorClassOf(err) }, 'Could not keep the deletion confirmation address; no email will be sent');
      return false;
    }
  }
}
