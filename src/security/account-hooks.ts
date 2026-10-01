import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';

import { type AccountExportContributor, AccountExportRegistry } from '../account/registry/account-registry';
import { SecurityEvent, SecurityEventType } from './models/security-event.model';

/** Most recent security events in an export (the log keeps 365 days). */
export const EXPORT_SECURITY_EVENT_LIMIT = 1000;

/**
 * The event types a user may see about themselves. Anything about moderation,
 * restriction or fraud guards (guide S5: no internal flags or moderation
 * state) is left out, and so is every event done by someone else (actor set).
 */
export const USER_VISIBLE_SECURITY_EVENTS: readonly SecurityEventType[] = [
  SecurityEventType.UserRegistered,
  SecurityEventType.LoginSucceeded,
  SecurityEventType.NewDevice,
  SecurityEventType.Logout,
  SecurityEventType.LogoutAll,
  SecurityEventType.SessionRevoked,
  SecurityEventType.ReauthRequested,
  SecurityEventType.ReauthSucceeded,
  SecurityEventType.ReauthFailed,
  SecurityEventType.ProfileCreated,
  SecurityEventType.ProfileDeleted,
  SecurityEventType.DataExportRequested,
  SecurityEventType.DataExportReady,
  SecurityEventType.DataExportUrlIssued,
];

/** Data export: the user's own security events of USER_VISIBLE_SECURITY_EVENTS, type and date only (no IPs, no metadata). */
@Injectable()
export class SecurityEventsExportContributor implements AccountExportContributor {
  readonly name = 'security_events';

  constructor(@InjectModel(SecurityEvent) private readonly eventModel: typeof SecurityEvent) {}

  async collect(userId: string): Promise<unknown> {
    const rows = await this.eventModel.findAll({
      attributes: ['eventType', 'createdAt'],
      where: { userId, actorUserId: null, eventType: { [Op.in]: [...USER_VISIBLE_SECURITY_EVENTS] } },
      order: [['id', 'DESC']],
      limit: EXPORT_SECURITY_EVENT_LIMIT,
    });
    return rows.map((e) => ({ type: e.eventType, at: e.createdAt.toISOString() }));
  }
}

@Injectable()
export class SecurityAccountHooksRegistrar implements OnModuleInit {
  constructor(
    private readonly exports: AccountExportRegistry,
    private readonly contributor: SecurityEventsExportContributor,
  ) {}

  onModuleInit(): void {
    this.exports.register(this.contributor);
  }
}
