import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, SequelizeModule } from '@nestjs/sequelize';
import { QueryTypes, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import { type AccountDeletionHandler, AccountDeletionRegistry } from '../account/registry/account-registry';
import { IdentifierType } from '../auth/models/otp-verification.model';
import { UserStatus } from '../users/models/user.model';
import { BanHashesService } from './ban-hashes.service';
import { BanHash } from './models/ban-hash.model';

/** Order: after every module's data, before `users` scrubs the identifiers. */
export const BANS_DELETION_ORDER = 900;

/**
 * Deleting a banned account keeps it banned: its identifier hashes (canonical
 * form) and the device ids of its sessions go to ban_hashes, so signing up
 * again with the same phone or an alias of the email is refused.
 */
@Injectable()
export class BansDeletionHandler implements AccountDeletionHandler {
  readonly name = 'bans';
  readonly order = BANS_DELETION_ORDER;

  constructor(
    private readonly bans: BanHashesService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async handle(userId: string, tx: Transaction): Promise<{ banHashesAdded: number }> {
    const [user] = await this.sequelize.query<{ status: string; email: string | null; phone: string | null }>(
      'SELECT status, email, phone FROM users WHERE id = :userId',
      { replacements: { userId }, type: QueryTypes.SELECT, transaction: tx },
    );
    if (!user || user.status !== UserStatus.Banned) return { banHashesAdded: 0 };
    const devices = await this.sequelize.query<{ device_id: string }>(
      'SELECT DISTINCT device_id FROM sessions WHERE user_id = :userId',
      { replacements: { userId }, type: QueryTypes.SELECT, transaction: tx },
    );
    const identifiers = [
      ...(user.email ? [{ type: IdentifierType.Email, value: user.email }] : []),
      ...(user.phone ? [{ type: IdentifierType.Phone, value: user.phone }] : []),
    ];
    const banHashesAdded = await this.bans.add(userId, { identifiers, deviceIds: devices.map((d) => d.device_id) }, tx);
    return { banHashesAdded };
  }
}

@Injectable()
class BansRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: AccountDeletionRegistry,
    private readonly handler: BansDeletionHandler,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.handler);
  }
}

@Module({
  imports: [SequelizeModule.forFeature([BanHash])],
  providers: [BanHashesService, BansDeletionHandler, BansRegistrar],
  exports: [BanHashesService],
})
export class BansModule {}
