/**
 * Every runtime setting (guide M08: app_settings, "the only way code reads
 * tunable limits"). Each key has a parser that validates a stored or new
 * value and a default used when no row exists. Keys are a closed set: code
 * can only ask for one of these (checked by the compiler), and a stored row
 * with any other key fails the boot.
 */
export class SettingValueError extends Error {
  override readonly name = 'SettingValueError';
}

interface SettingDefinition<T> {
  default: T;
  /** Returns the value as T, or throws SettingValueError with a short reason. */
  parse(value: unknown): T;
  /** Shown in GET /app/config. */
  public?: boolean;
}

const int = (min: number, max: number, fallback: number): SettingDefinition<number> => ({
  default: fallback,
  parse(value) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw new SettingValueError(`must be an integer from ${min} to ${max}`);
    }
    return value;
  },
});

const bool = (fallback: boolean, isPublic = false): SettingDefinition<boolean> => ({
  default: fallback,
  public: isPublic,
  parse(value) {
    if (typeof value !== 'boolean') throw new SettingValueError('must be true or false');
    return value;
  },
});

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const version = (fallback: string): SettingDefinition<string> => ({
  default: fallback,
  public: true,
  parse(value) {
    if (typeof value !== 'string' || !VERSION.test(value)) throw new SettingValueError('must be a version such as 1.4.0');
    return value;
  },
});

/** An object with exactly the given keys, each validated. */
function record<T extends Record<string, unknown>>(
  fields: { [K in keyof T]: (v: unknown) => T[K] },
  fallback: T,
): SettingDefinition<T> {
  return {
    default: fallback,
    public: true,
    parse(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new SettingValueError('must be an object');
      const input = value as Record<string, unknown>;
      const extra = Object.keys(input).filter((k) => !(k in fields));
      if (extra.length > 0) throw new SettingValueError(`unknown field ${extra[0]}`);
      const out = {} as T;
      for (const key of Object.keys(fields) as Array<keyof T>) {
        if (!(key in input)) throw new SettingValueError(`missing field ${String(key)}`);
        out[key] = fields[key](input[key as string]);
      }
      return out;
    },
  };
}

const flag = (v: unknown): boolean => {
  if (typeof v !== 'boolean') throw new SettingValueError('flags must be true or false');
  return v;
};

const HTTPS_URL = /^https:\/\/[^\s/$.?#][^\s]{0,300}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const httpsUrlOrNull = (v: unknown): string | null => {
  if (v === null) return null;
  if (typeof v !== 'string' || !HTTPS_URL.test(v)) throw new SettingValueError('links must be https:// URLs or null');
  return v;
};
const emailOrNull = (v: unknown): string | null => {
  if (v === null) return null;
  if (typeof v !== 'string' || !EMAIL.test(v)) throw new SettingValueError('must be an email address or null');
  return v;
};

export type PublicFeatureFlags = {
  voiceVideoCalls: boolean;
  contactExchange: boolean;
  idVerification: boolean;
};

export type SupportLinks = {
  helpCenterUrl: string | null;
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
  supportEmail: string | null;
};

export const SETTINGS = {
  'profile.max_interests': int(1, 50, 10),
  /** Interests needed for the interests part of the completion score. */
  'profile.min_interests_for_completion': int(0, 50, 3),
  'preferences.min_distance_km': int(1, 20_000, 1),
  'preferences.max_distance_km': int(1, 20_000, 200),
  /** Shown before a user saves preferences. */
  'preferences.default_distance_km': int(1, 20_000, 50),
  'app.min_version.android': version('1.0.0'),
  'app.min_version.ios': version('1.0.0'),
  'app.maintenance': bool(false, true),
  'app.feature_flags': record<PublicFeatureFlags>(
    { voiceVideoCalls: flag, contactExchange: flag, idVerification: flag },
    { voiceVideoCalls: false, contactExchange: false, idVerification: false },
  ),
  'app.support_links': record<SupportLinks>(
    { helpCenterUrl: httpsUrlOrNull, privacyPolicyUrl: httpsUrlOrNull, termsUrl: httpsUrlOrNull, supportEmail: emailOrNull },
    { helpCenterUrl: null, privacyPolicyUrl: null, termsUrl: null, supportEmail: null },
  ),
} satisfies Record<string, SettingDefinition<unknown>>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K]['default'];
export type SettingValues = { [K in SettingKey]: SettingValue<K> };

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, key);
}

export function parseSetting<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
  return (SETTINGS[key] as SettingDefinition<SettingValue<K>>).parse(value);
}

export function defaultSettings(): SettingValues {
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, SETTINGS[k].default])) as SettingValues;
}

/** Rules across keys, checked on every set() against the values it would produce. */
export function checkInvariants(values: SettingValues): void {
  const min = values['preferences.min_distance_km'];
  const max = values['preferences.max_distance_km'];
  const fallback = values['preferences.default_distance_km'];
  if (min > max) throw new SettingValueError('preferences.min_distance_km must not exceed preferences.max_distance_km');
  if (fallback < min || fallback > max) {
    throw new SettingValueError('preferences.default_distance_km must be between the min and max distance');
  }
}
