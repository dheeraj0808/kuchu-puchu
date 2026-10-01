import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { InjectModel, SequelizeModule } from '@nestjs/sequelize';
import { literal, type Transaction } from 'sequelize';

import {
  type AccountDeletionHandler,
  AccountDeletionRegistry,
  type AccountExportContributor,
  AccountExportRegistry,
} from '../account/registry/account-registry';
import { Session, SessionRevokeReason } from './models/session.model';
import { SessionStateModule, SessionStateService } from './session-state/session-state.service';

/** What a session row keeps after its account is deleted: dates and platform only. */
const SCRUBBED = { ipAddress: '', userAgent: '', deviceName: 'deleted', appVersion: '0' };

/**
 * Account deletion: every open session is revoked ("deleted"), the cache keys
 * go after the commit, and every session row of the user loses its IP, user
 * agent, device name and token hashes. Device ids stay until
 * AuthDevicesDeletionHandler, after the bans handler has read them.
 */
@Injectable()
export class AuthDeletionHandler implements AccountDeletionHandler {
  readonly name = 'auth';
  readonly order = 10;

  constructor(
    @InjectModel(Session) private readonly sessionModel: typeof Session,
    private readonly sessionState: SessionStateService,
  ) {}

  async handle(userId: string, tx: Transaction): Promise<{ revokedSessions: number; scrubbedSessions: number }> {
    const [revokedSessions] = await this.sessionModel.update(
      { revokedAt: new Date(), revokedReason: SessionRevokeReason.Deleted },
      { where: { userId, revokedAt: null }, transaction: tx },
    );
    // Token hashes become random per row: no token can ever match one again.
    const [scrubbedSessions] = await this.sessionModel.update(
      { ...SCRUBBED, refreshTokenHash: literal('SHA2(CONCAT(UUID(), id), 256)'), previousTokenHash: null },
      { where: { userId }, transaction: tx },
    );
    await this.sessionState.invalidateUser(userId, tx);
    return { revokedSessions, scrubbedSessions };
  }
}

/** After `bans` (900) has hashed them: the device ids of the user's sessions are replaced too. */
@Injectable()
export class AuthDevicesDeletionHandler implements AccountDeletionHandler {
  readonly name = 'auth.devices';
  readonly order = 950;

  constructor(@InjectModel(Session) private readonly sessionModel: typeof Session) {}

  async handle(userId: string, tx: Transaction): Promise<void> {
    await this.sessionModel.update({ deviceId: 'deleted' }, { where: { userId }, transaction: tx });
  }
}

/** Data export: the user's own devices (no IPs, no user agents, no token hashes). */
@Injectable()
export class SessionsExportContributor implements AccountExportContributor {
  readonly name = 'sessions';

  constructor(@InjectModel(Session) private readonly sessionModel: typeof Session) {}

  async collect(userId: string): Promise<unknown> {
    const rows = await this.sessionModel.findAll({
      attributes: ['deviceName', 'platform', 'appVersion', 'createdAt', 'lastUsedAt', 'revokedAt', 'revokedReason'],
      where: { userId },
      order: [['createdAt', 'ASC']],
    });
    return rows.map((s) => ({
      deviceName: s.deviceName,
      platform: s.platform,
      appVersion: s.appVersion,
      signedInAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      signedOutAt: s.revokedAt?.toISOString() ?? null,
      signedOutReason: s.revokedReason,
    }));
  }
}

@Injectable()
class AuthAccountHooksRegistrar implements OnModuleInit {
  constructor(
    private readonly deletion: AccountDeletionRegistry,
    private readonly exports: AccountExportRegistry,
    private readonly handler: AuthDeletionHandler,
    private readonly devices: AuthDevicesDeletionHandler,
    private readonly contributor: SessionsExportContributor,
  ) {}

  onModuleInit(): void {
    this.deletion.register(this.handler);
    this.deletion.register(this.devices);
    this.exports.register(this.contributor);
  }
}

/** Auth's account hooks, without the rest of AuthModule (the worker imports this too). */
@Module({
  imports: [SequelizeModule.forFeature([Session]), SessionStateModule],
  providers: [AuthDeletionHandler, AuthDevicesDeletionHandler, SessionsExportContributor, AuthAccountHooksRegistrar],
})
export class AuthAccountHooksModule {}
