import { Injectable } from '@nestjs/common';
import type { Transaction } from 'sequelize';

/** Profile columns another module may fill when the profile is created. */
export interface ProfileCreationAttrs {
  faceVerifiedAt?: Date | null;
}

/**
 * Runs inside the profile-create transaction, before the profile row is
 * read or written, so a hook may take locks that its own writers take first
 * (no lock-order inversion). Returns the columns it owns.
 */
export interface ProfileCreationHook {
  readonly name: string;
  beforeCreate(userId: string, tx: Transaction): Promise<ProfileCreationAttrs>;
}

/**
 * Lets modules that ProfilesModule must not import (M11 verification
 * imports profiles) fill their profile columns on create. Modules register
 * from onModuleInit; a duplicate name fails the boot.
 */
@Injectable()
export class ProfileCreationHooks {
  private readonly hooks = new Map<string, ProfileCreationHook>();

  register(hook: ProfileCreationHook): void {
    if (this.hooks.has(hook.name)) throw new Error(`Duplicate profile creation hook "${hook.name}"`);
    this.hooks.set(hook.name, hook);
  }

  async beforeCreate(userId: string, tx: Transaction): Promise<ProfileCreationAttrs> {
    const attrs: ProfileCreationAttrs = {};
    for (const hook of this.hooks.values()) Object.assign(attrs, await hook.beforeCreate(userId, tx));
    return attrs;
  }
}
