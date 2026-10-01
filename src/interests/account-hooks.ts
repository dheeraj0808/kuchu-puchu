import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import {
  type AccountDeletionHandler,
  AccountDeletionRegistry,
  type AccountExportContributor,
  AccountExportRegistry,
} from '../account/registry/account-registry';
import { InterestsService } from './interests.service';

/** Account deletion: the user's interest selections (never the catalogue). Runs before the profile is scrubbed. */
@Injectable()
export class InterestsDeletionHandler implements AccountDeletionHandler {
  readonly name = 'interests';
  readonly order = 20;

  constructor(
    private readonly interests: InterestsService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async handle(userId: string, tx: Transaction): Promise<{ interestsDeleted: number }> {
    const profiles = await this.sequelize.query<{ id: string }>('SELECT id FROM profiles WHERE user_id = :userId', {
      replacements: { userId },
      type: QueryTypes.SELECT,
      transaction: tx,
    });
    let interestsDeleted = 0;
    for (const p of profiles) interestsDeleted += await this.interests.removeAllForProfile(p.id, tx);
    return { interestsDeleted };
  }
}

/** Data export: the interests the user selected. */
@Injectable()
export class InterestsExportContributor implements AccountExportContributor {
  readonly name = 'interests';

  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async collect(userId: string): Promise<unknown> {
    return this.sequelize.query<{ name: string; slug: string; selectedAt: Date }>(
      `SELECT i.name AS name, i.slug AS slug, pi.created_at AS selectedAt
         FROM profile_interests pi
         JOIN profiles p ON p.id = pi.profile_id
         JOIN interests i ON i.id = pi.interest_id
        WHERE p.user_id = :userId
        ORDER BY pi.created_at, i.slug`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
  }
}

@Injectable()
export class InterestsAccountHooksRegistrar implements OnModuleInit {
  constructor(
    private readonly deletion: AccountDeletionRegistry,
    private readonly exports: AccountExportRegistry,
    private readonly handler: InterestsDeletionHandler,
    private readonly contributor: InterestsExportContributor,
  ) {}

  onModuleInit(): void {
    this.deletion.register(this.handler);
    this.exports.register(this.contributor);
  }
}

export const INTERESTS_ACCOUNT_HOOKS = [InterestsDeletionHandler, InterestsExportContributor, InterestsAccountHooksRegistrar];
