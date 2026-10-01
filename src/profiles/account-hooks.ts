import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Transaction } from 'sequelize';

import {
  type AccountDeletionHandler,
  AccountDeletionRegistry,
  type AccountExportContributor,
  AccountExportRegistry,
} from '../account/registry/account-registry';
import { ProfilesService } from './profiles.service';

/** Account deletion: the profile is hidden, its fields scrubbed, and it is soft-deleted. */
@Injectable()
export class ProfileDeletionHandler implements AccountDeletionHandler {
  readonly name = 'profile';
  readonly order = 30;

  constructor(private readonly profiles: ProfilesService) {}

  async handle(userId: string, tx: Transaction): Promise<{ profileDeleted: boolean }> {
    return { profileDeleted: await this.profiles.deactivateForAccountDeletion(userId, tx) };
  }
}

/** Data export: the owner's own profile view, or null. */
@Injectable()
export class ProfileExportContributor implements AccountExportContributor {
  readonly name = 'profile';

  constructor(private readonly profiles: ProfilesService) {}

  collect(userId: string): Promise<unknown> {
    return this.profiles.getOwnOrNull(userId);
  }
}

@Injectable()
export class ProfileAccountHooksRegistrar implements OnModuleInit {
  constructor(
    private readonly deletion: AccountDeletionRegistry,
    private readonly exports: AccountExportRegistry,
    private readonly handler: ProfileDeletionHandler,
    private readonly contributor: ProfileExportContributor,
  ) {}

  onModuleInit(): void {
    this.deletion.register(this.handler);
    this.exports.register(this.contributor);
  }
}

export const PROFILE_ACCOUNT_HOOKS = [ProfileDeletionHandler, ProfileExportContributor, ProfileAccountHooksRegistrar];
