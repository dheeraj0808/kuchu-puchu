import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Transaction } from 'sequelize';

import {
  type AccountDeletionHandler,
  AccountDeletionRegistry,
  type AccountExportContributor,
  AccountExportRegistry,
  LAST_ORDER,
} from '../account/registry/account-registry';
import { UsersService } from './users.service';

/** Runs last (enforced by the registry): every other handler may still need the user row as it was. */
export const USERS_DELETION_ORDER = LAST_ORDER;

/** Account deletion: email and phone NULL (free to sign up again), status deactivated, soft-deleted. */
@Injectable()
export class UsersDeletionHandler implements AccountDeletionHandler {
  readonly name = 'users';
  readonly order = USERS_DELETION_ORDER;

  constructor(private readonly users: UsersService) {}

  async handle(userId: string, tx: Transaction): Promise<void> {
    const user = await this.users.findById(userId, tx);
    if (!user) throw new Error('User row vanished during deletion');
    await this.users.anonymizeAndSoftDelete(user, tx);
  }
}

/** Data export: the account record. The identifiers are the user's own, so they are given in full. */
@Injectable()
export class AccountExportContributorImpl implements AccountExportContributor {
  readonly name = 'account';

  constructor(private readonly users: UsersService) {}

  async collect(userId: string): Promise<unknown> {
    const user = await this.users.findById(userId);
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    };
  }
}

@Injectable()
export class UsersAccountHooksRegistrar implements OnModuleInit {
  constructor(
    private readonly deletion: AccountDeletionRegistry,
    private readonly exports: AccountExportRegistry,
    private readonly handler: UsersDeletionHandler,
    private readonly contributor: AccountExportContributorImpl,
  ) {}

  onModuleInit(): void {
    this.deletion.register(this.handler);
    this.exports.register(this.contributor);
  }
}

export const USERS_ACCOUNT_HOOKS = [UsersDeletionHandler, AccountExportContributorImpl, UsersAccountHooksRegistrar];
