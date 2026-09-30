/**
 * Entitlement keys and plan values from guide M21 ("Plan matrix"). Code checks
 * entitlements, never plan names. M21 stores these in plans.entitlements.
 */
export enum EntitlementKey {
  DailyLikes = 'daily_likes',
  SeeWhoLikedMe = 'see_who_liked_me',
  UndoPass = 'undo_pass',
  AdvancedFilters = 'advanced_filters',
  PriorityLikes = 'priority_likes',
  BoostsPerMonth = 'boosts_per_month',
  ContactExchangePerMonth = 'contact_exchange_per_month',
  VoiceVideoCalls = 'voice_video_calls',
  TravelMode = 'travel_mode',
  Incognito = 'incognito',
}

export type QuotaPeriod = 'day' | 'week' | 'month';

/** On/off feature. */
export interface FlagEntitlement {
  kind: 'flag';
  enabled: boolean;
}
/** Counted feature. `limit: null` means unlimited (a fair-use ceiling from config, M21). */
export interface QuotaEntitlement {
  kind: 'quota';
  limit: number | null;
  period: QuotaPeriod;
}
/** Tiered feature; `levels` is ordered lowest first and includes 'none'. */
export interface LevelEntitlement {
  kind: 'level';
  level: string;
  levels: readonly string[];
}
export type EntitlementValue = FlagEntitlement | QuotaEntitlement | LevelEntitlement;
export type EntitlementSet = Record<EntitlementKey, EntitlementValue>;

export const SEE_WHO_LIKED_ME_LEVELS = ['none', 'count_only', 'full_list'] as const;
export const ADVANCED_FILTER_LEVELS = ['none', 'basic', 'all'] as const;

/** Free plan column of the M21 plan matrix. */
export const FREE_PLAN_ENTITLEMENTS: Readonly<EntitlementSet> = Object.freeze({
  [EntitlementKey.DailyLikes]: { kind: 'quota', limit: 25, period: 'day' },
  [EntitlementKey.SeeWhoLikedMe]: { kind: 'level', level: 'count_only', levels: SEE_WHO_LIKED_ME_LEVELS },
  [EntitlementKey.UndoPass]: { kind: 'quota', limit: 0, period: 'day' },
  [EntitlementKey.AdvancedFilters]: { kind: 'level', level: 'none', levels: ADVANCED_FILTER_LEVELS },
  [EntitlementKey.PriorityLikes]: { kind: 'quota', limit: 0, period: 'week' },
  [EntitlementKey.BoostsPerMonth]: { kind: 'quota', limit: 0, period: 'month' },
  [EntitlementKey.ContactExchangePerMonth]: { kind: 'quota', limit: 0, period: 'month' },
  [EntitlementKey.VoiceVideoCalls]: { kind: 'flag', enabled: false },
  [EntitlementKey.TravelMode]: { kind: 'flag', enabled: false },
  [EntitlementKey.Incognito]: { kind: 'flag', enabled: false },
});

/** One user's resolved entitlements. */
export class UserEntitlements {
  constructor(private readonly values: Readonly<EntitlementSet>) {}

  /**
   * Whether the feature is available: a flag that is on, a quota above 0 (or
   * unlimited), or a level at or above `minLevel` (default: anything but 'none').
   */
  has(key: EntitlementKey, minLevel?: string): boolean {
    const v = this.values[key];
    switch (v.kind) {
      case 'flag':
        return v.enabled;
      case 'quota':
        return v.limit === null || v.limit > 0;
      case 'level': {
        const current = v.levels.indexOf(v.level);
        const required = minLevel === undefined ? 1 : v.levels.indexOf(minLevel);
        if (required < 0) throw new Error(`Unknown level "${minLevel}" for entitlement ${key}`);
        return current >= required;
      }
    }
  }

  /** The quota for a counted feature; null means unlimited. */
  limit(key: EntitlementKey): number | null {
    const v = this.values[key];
    if (v.kind !== 'quota') throw new Error(`Entitlement ${key} is not a quota`);
    return v.limit;
  }

  /** The current level of a tiered feature. */
  level(key: EntitlementKey): string {
    const v = this.values[key];
    if (v.kind !== 'level') throw new Error(`Entitlement ${key} is not tiered`);
    return v.level;
  }
}
