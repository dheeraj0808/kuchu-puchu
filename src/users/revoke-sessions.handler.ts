import { Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import { SessionStateModule, SessionStateService } from '../auth/session-state/session-state.service';
import { type DeliveredEvent, type EventHandler, HandlerRegistry } from '../events/handler-registry';
import { SecurityEventType } from '../security/models/security-event.model';
import { SecurityEventsService } from '../security/security-events.service';
import { UserStatus } from './models/user.model';

/**
 * user.status_changed → revoke every session of a user who may no longer
 * authenticate (reason "restricted") and drop their session cache.
 * Idempotent: it acts on the user's CURRENT status, and revoking already
 * revoked sessions changes nothing. Socket disconnect → M19; closing matches
 * on ban → M16.
 */
@Injectable()
export class RevokeSessionsHandler implements EventHandler<'user.status_changed'> {
  readonly name = 'users.revoke_sessions';
  readonly eventType = 'user.status_changed' as const;
  private readonly logger = new Logger(RevokeSessionsHandler.name);

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly sessionState: SessionStateService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  async handle(event: DeliveredEvent<'user.status_changed'>): Promise<void> {
    const { userId } = event.payload;
    const [row] = await this.sequelize.query<{ status: string }>('SELECT status FROM users WHERE id = :userId', {
      replacements: { userId },
      type: QueryTypes.SELECT,
    });
    // Reactivated since the event (or gone): nothing to revoke.
    if (!row || row.status === UserStatus.Active) return;
    const revoked = await this.sessionState.revokeAllForRestriction(userId);
    if (revoked > 0) {
      await this.securityEvents.record({
        eventType: SecurityEventType.SessionRevoked,
        userId,
        metadata: { reason: 'restricted', status: row.status, revokedSessions: revoked, outboxId: event.outboxId },
      });
      this.logger.log({ revokedSessions: revoked }, 'Revoked the sessions of a restricted user');
    }
  }
}

@Injectable()
class UsersHandlersRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: HandlerRegistry,
    private readonly revokeSessions: RevokeSessionsHandler,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.revokeSessions);
  }
}

/** Worker only: the users module's outbox handlers. */
@Module({
  imports: [SessionStateModule],
  providers: [RevokeSessionsHandler, UsersHandlersRegistrar],
})
export class UsersWorkerModule {}
