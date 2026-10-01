import { Global, Injectable, Module } from '@nestjs/common';
import type { Transaction } from 'sequelize';

/** The users handler runs last, at this order; every other handler must be below it. */
export const LAST_HANDLER = 'users';
export const LAST_ORDER = 1000;

/** Unique across the app; `[a-z0-9_.]`, max 64. */
export const HOOK_NAME = /^[a-z0-9_.]{1,64}$/;

/**
 * One module's part of account deletion (guide §3.5, M07). Runs inside the
 * deletion transaction, with the user row locked. Throw to roll the whole
 * deletion back. Files and other side effects go through outbox events
 * published in `tx`, so they happen only after the commit.
 */
export interface AccountDeletionHandler {
  readonly name: string;
  /** Lower runs first; `users` runs last. */
  readonly order: number;
  /** Returns counts for the audit event (no PII), or nothing. */
  handle(userId: string, tx: Transaction): Promise<Record<string, number | boolean> | void>;
}

/**
 * One module's part of a data export (M07). Returns JSON-serialisable data
 * that belongs to `userId` only; it becomes `<name>.json` in the ZIP.
 */
export interface AccountExportContributor {
  readonly name: string;
  collect(userId: string): Promise<unknown>;
}

abstract class NamedRegistry<T extends { name: string }> {
  protected readonly items = new Map<string, T>();

  constructor(private readonly kind: string) {}

  register(item: T): void {
    if (typeof item.name !== 'string' || !HOOK_NAME.test(item.name)) {
      throw new Error(`Invalid ${this.kind} name "${String(item.name)}": use [a-z0-9_.], 1–64 chars`);
    }
    if (this.items.has(item.name)) throw new Error(`Duplicate ${this.kind} "${item.name}"`);
    this.items.set(item.name, item);
  }

  names(): string[] {
    return [...this.items.keys()];
  }
}

/** Modules register their handlers from onModuleInit; a duplicate name fails the boot. */
@Injectable()
export class AccountDeletionRegistry extends NamedRegistry<AccountDeletionHandler> {
  constructor() {
    super('account deletion handler');
  }

  override register(handler: AccountDeletionHandler): void {
    if (!Number.isInteger(handler.order)) throw new Error(`Account deletion handler "${handler.name}" needs an integer order`);
    // `users` scrubs the identifiers that others may still need: it must stay last.
    if (handler.name === LAST_HANDLER ? handler.order !== LAST_ORDER : handler.order >= LAST_ORDER) {
      throw new Error(`Account deletion handler "${handler.name}": only "${LAST_HANDLER}" may use order ${LAST_ORDER}, and nothing may run after it`);
    }
    super.register(handler);
  }

  /** By order, then name, so the sequence never depends on module load order. */
  ordered(): AccountDeletionHandler[] {
    return [...this.items.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }
}

@Injectable()
export class AccountExportRegistry extends NamedRegistry<AccountExportContributor> {
  constructor() {
    super('account export contributor');
  }

  /** By name, so the ZIP layout is stable. */
  all(): AccountExportContributor[] {
    return [...this.items.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

/**
 * Global, so every module can register without importing AccountModule, and
 * AccountService runs every module's hooks without importing any of them.
 */
@Global()
@Module({ providers: [AccountDeletionRegistry, AccountExportRegistry], exports: [AccountDeletionRegistry, AccountExportRegistry] })
export class AccountRegistryModule {}
