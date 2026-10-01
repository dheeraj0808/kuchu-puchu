import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Transaction } from 'sequelize';

import {
  type AccountDeletionHandler,
  AccountDeletionRegistry,
  type AccountExportContributor,
  AccountExportRegistry,
} from '../account/registry/account-registry';
import { PreferencesResponse } from './dto/preferences.response';
import { PreferencesService } from './preferences.service';

/** Account deletion: the dating preferences row is hard-deleted. */
@Injectable()
export class PreferencesDeletionHandler implements AccountDeletionHandler {
  readonly name = 'preferences';
  readonly order = 25;

  constructor(private readonly preferences: PreferencesService) {}

  async handle(userId: string, tx: Transaction): Promise<{ preferencesDeleted: number }> {
    return { preferencesDeleted: await this.preferences.deleteForUser(userId, tx) };
  }
}

/** Data export: the saved preferences, or null when the user never set any. */
@Injectable()
export class PreferencesExportContributor implements AccountExportContributor {
  readonly name = 'preferences';

  constructor(private readonly preferences: PreferencesService) {}

  async collect(userId: string): Promise<unknown> {
    const pref = await this.preferences.findByUserId(userId);
    return pref ? PreferencesResponse.fromModel(pref) : null;
  }
}

@Injectable()
export class PreferencesAccountHooksRegistrar implements OnModuleInit {
  constructor(
    private readonly deletion: AccountDeletionRegistry,
    private readonly exports: AccountExportRegistry,
    private readonly handler: PreferencesDeletionHandler,
    private readonly contributor: PreferencesExportContributor,
  ) {}

  onModuleInit(): void {
    this.deletion.register(this.handler);
    this.exports.register(this.contributor);
  }
}

export const PREFERENCES_ACCOUNT_HOOKS = [PreferencesDeletionHandler, PreferencesExportContributor, PreferencesAccountHooksRegistrar];
