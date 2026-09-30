import { Global, Injectable, Module } from '@nestjs/common';

import { type EntitlementKey, FREE_PLAN_ENTITLEMENTS, UserEntitlements } from './entitlements';

/**
 * The one read API for "what is this user allowed to do?" (guide §3.5, M21).
 * Inject this abstract class; never a concrete implementation. M21 replaces
 * the provider in EntitlementsModule, and no caller changes.
 */
export abstract class EntitlementsService {
  abstract get(userId: string): Promise<UserEntitlements>;

  async has(userId: string, key: EntitlementKey, minLevel?: string): Promise<boolean> {
    return (await this.get(userId)).has(key, minLevel);
  }

  async limit(userId: string, key: EntitlementKey): Promise<number | null> {
    return (await this.get(userId)).limit(key);
  }
}

/** Stub until M21: every user is on the Free plan. */
@Injectable()
export class FreePlanEntitlementsService extends EntitlementsService {
  private readonly free = new UserEntitlements(FREE_PLAN_ENTITLEMENTS);

  get(_userId: string): Promise<UserEntitlements> {
    return Promise.resolve(this.free);
  }
}

@Global()
@Module({
  providers: [{ provide: EntitlementsService, useClass: FreePlanEntitlementsService }],
  exports: [EntitlementsService],
})
export class EntitlementsModule {}
