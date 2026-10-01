/**
 * Which settings GET /app/config shows is decided there (CatalogService), by
 * a fixed list, never by this registry.
 *
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

const bool = (fallback: boolean): SettingDefinition<boolean> => ({
  default: fallback,
  parse(value) {
    if (typeof value !== 'boolean') throw new SettingValueError('must be true or false');
    return value;
  },
});

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const version = (fallback: string): SettingDefinition<string> => ({
  default: fallback,
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
    parse(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new SettingValueError('must be an object');
      const input = value as Record<string, unknown>;
      // Own keys only: "__proto__", "constructor" and friends are unknown fields like any other.
      const extra = Reflect.ownKeys(input).filter((k) => typeof k !== 'string' || !Object.hasOwn(fields, k));
      if (extra.length > 0) throw new SettingValueError(`unknown field ${String(extra[0]).slice(0, 32)}`);
      const out = {} as T;
      for (const key of Object.keys(fields) as Array<keyof T & string>) {
        if (!Object.hasOwn(input, key)) throw new SettingValueError(`missing field ${key}`);
        out[key] = fields[key](input[key]);
      }
      return out;
    },
  };
}

const flag = (v: unknown): boolean => {
  if (typeof v !== 'boolean') throw new SettingValueError('flags must be true or false');
  return v;
};

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const HOSTNAME = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** https only, a real host name (no IPs, no "localhost"), no user:password@, at most 300 chars. */
const httpsUrlOrNull = (v: unknown): string | null => {
  if (v === null) return null;
  const bad = new SettingValueError('links must be https:// URLs on a public host name, or null');
  if (typeof v !== 'string' || v.length > 300) throw bad;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw bad;
  }
  if (url.protocol !== 'https:' || url.username || url.password || !HOSTNAME.test(url.hostname)) throw bad;
  return url.toString();
};
/** A role mailbox such as support@…, never a person's address. */
const emailOrNull = (v: unknown): string | null => {
  if (v === null) return null;
  if (typeof v !== 'string' || v.length > 254 || !EMAIL.test(v)) throw new SettingValueError('must be an email address or null');
  return v;
};

const CONSENT_VERSION = /^[A-Za-z0-9._-]{1,20}$/;
/** Non-empty list of distinct consent versions (VARCHAR(20) each). Not public. */
const consentVersions = (fallback: string[]): SettingDefinition<string[]> => ({
  default: fallback,
  parse(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 20) throw new SettingValueError('must be a list of 1 to 20 versions');
    for (const v of value) {
      if (typeof v !== 'string' || !CONSENT_VERSION.test(v)) throw new SettingValueError('versions must match [A-Za-z0-9._-], 1–20 chars');
    }
    if (new Set(value).size !== value.length) throw new SettingValueError('versions must be distinct');
    return [...(value as string[])];
  },
});

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
  /** M11: decided selfie attempts allowed in any rolling 24 h. */
  'verification.face.attempts_per_day': int(1, 20, 3),
  /** M11: decided selfie attempts allowed over the account's life; then only support can help. */
  'verification.face.attempts_total': int(1, 100, 10),
  /** M11: the selfie of a rejected attempt is deleted this many days after the decision. */
  'verification.face.rejected_retention_days': int(1, 365, 30),
  /** M11: consent-screen versions the app may send with POST /verification/face/session. */
  'verification.face.consent_versions': consentVersions(['v1']),
  'app.min_version.android': version('1.0.0'),
  'app.min_version.ios': version('1.0.0'),
  'app.maintenance': bool(false),
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
  if (values['profile.min_interests_for_completion'] > values['profile.max_interests']) {
    throw new SettingValueError('profile.min_interests_for_completion must not exceed profile.max_interests');
  }
  const min = values['preferences.min_distance_km'];
  const max = values['preferences.max_distance_km'];
  const fallback = values['preferences.default_distance_km'];
  if (min > max) throw new SettingValueError('preferences.min_distance_km must not exceed preferences.max_distance_km');
  if (fallback < min || fallback > max) {
    throw new SettingValueError('preferences.default_distance_km must be between the min and max distance');
  }
  if (values['verification.face.attempts_per_day'] > values['verification.face.attempts_total']) {
    throw new SettingValueError('verification.face.attempts_per_day must not exceed verification.face.attempts_total');
  }
}
