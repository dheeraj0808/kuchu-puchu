import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import type { Redis } from 'ioredis';
import { QueryTypes, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import { errorClassOf } from '../infra/alerts/alert.provider';
import { REDIS_CLIENT } from '../infra/redis/redis.module';
import { SecurityEventType } from '../security/models/security-event.model';
import { SecurityEventsService } from '../security/security-events.service';
import { UserRole } from '../users/models/user.model';
import { AppSetting } from './models/app-setting.model';
import {
  SETTINGS_CACHE_KEY,
  SETTINGS_CACHE_TTL_SECONDS,
  SETTINGS_DEPENDENT_CACHE_KEYS,
  SETTINGS_GENERATION_KEY,
} from './settings.cache';
import {
  checkInvariants,
  defaultSettings,
  isSettingKey,
  parseSetting,
  SETTING_KEYS,
  type SettingKey,
  SettingValueError,
  type SettingValue,
  type SettingValues,
} from './settings.registry';

/** A set() with an unknown key: a programming error, never shown to clients as such. */
export class UnknownSettingError extends Error {
  override readonly name = 'UnknownSettingError';
}

/** Cache the value only if no set() bumped the generation since this read began. */
const SET_IF_GENERATION = `
local current = redis.call('GET', KEYS[2]) or '0'
if current ~= ARGV[3] then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 1`;

/**
 * Runtime settings (guide M08). Reads go through one Redis entry holding
 * every value (10 min), falling back to MySQL and then to the registry
 * defaults; whatever comes back is parsed key by key, so a damaged cache or
 * row can never switch a limit off. set() validates, writes, audits and
 * drops every dependent cache key; a generation counter stops a read that
 * started before the change from caching the old values again.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectModel(AppSetting) private readonly settingModel: typeof AppSetting,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly securityEvents: SecurityEventsService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * An unknown key in app_settings fails the boot: the code and the data
   * disagree (owner decision). Deploy order therefore matters: ship the code
   * that knows a new key before any row for it is written.
   */
  async onModuleInit(): Promise<void> {
    const rows = await this.settingModel.findAll({ attributes: ['key'] });
    const unknown = rows.map((r) => r.key).filter((k) => !isSettingKey(k));
    if (unknown.length > 0) throw new UnknownSettingError(`app_settings has keys this build does not know: ${unknown.join(', ')}`);
  }

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    return (await this.all())[key];
  }

  /** Every setting, stored values over defaults, always valid. */
  async all(): Promise<SettingValues> {
    let generation = '0';
    let redisUp = true;
    try {
      const [cached, gen] = await this.redis.mget(SETTINGS_CACHE_KEY, SETTINGS_GENERATION_KEY);
      generation = gen ?? '0';
      if (cached) {
        const values = sanitize(safeJson(cached));
        if (values) return values;
      }
    } catch (err) {
      redisUp = false;
      this.logger.warn({ err: errorClassOf(err) }, 'Settings cache read failed; using the database');
    }
    const values = await this.load();
    if (redisUp) {
      await this.redis
        .eval(SET_IF_GENERATION, 2, SETTINGS_CACHE_KEY, SETTINGS_GENERATION_KEY, JSON.stringify(values), SETTINGS_CACHE_TTL_SECONDS, generation)
        .catch(() => undefined);
    }
    return values;
  }

  /**
   * Changes a setting (M15's PUT /admin/settings/:key calls this). The actor
   * must be an admin, re-read from the database (guide S1/S9: roles are never
   * trusted from the caller); anyone else → 403 FORBIDDEN. Validates the value
   * and the rules across keys with every row locked, writes it, records a
   * strict admin.setting_changed event and drops the caches. Invalid → 400
   * VALIDATION_ERROR.
   */
  async set<K extends SettingKey>(key: K, value: unknown, actorUserId: string): Promise<SettingValue<K>> {
    if (!isSettingKey(key)) throw new UnknownSettingError(`Unknown setting "${String(key)}"`);
    const parsed = await this.sequelize.transaction(async (transaction) => {
      await this.assertAdmin(actorUserId, transaction);
      // Locks every row, so two parallel set() calls cannot each pass the cross-key rules.
      const rows = await this.settingModel.findAll({ transaction, lock: transaction.LOCK.UPDATE });
      const current = this.merge(rows);
      let next: SettingValue<K>;
      try {
        next = parseSetting(key, value);
        checkInvariants({ ...current, [key]: next });
      } catch (err) {
        if (!(err instanceof SettingValueError)) throw err;
        throw new AppException(ErrorCode.ValidationError, { errors: [{ field: key, message: err.message }] });
      }
      await this.settingModel.upsert({ key, value: next, updatedBy: actorUserId }, { transaction });
      const from = current[key];
      await this.securityEvents.record({
        eventType: SecurityEventType.AdminSettingChanged,
        actorUserId,
        // Settings hold no personal data. changedFields survives the audit's PII key filter (e.g. supportEmail).
        metadata: { key, from, to: next, changedFields: changedFields(from, next) },
        transaction,
        strict: true,
      });
      return next;
    });
    await this.invalidate();
    return parsed;
  }

  /** Bumps the generation and drops the settings, app config and catalogue caches. */
  async invalidate(): Promise<void> {
    try {
      await this.redis.multi().incr(SETTINGS_GENERATION_KEY).del(...SETTINGS_DEPENDENT_CACHE_KEYS).exec();
    } catch (err) {
      this.logger.error({ err: errorClassOf(err) }, 'Settings cache delete failed; values refresh within 10 minutes');
    }
  }

  private async assertAdmin(actorUserId: string, transaction: Transaction): Promise<void> {
    const [actor] = await this.sequelize.query<{ role: string }>(
      'SELECT role FROM users WHERE id = :id AND deleted_at IS NULL AND status = :active',
      { replacements: { id: actorUserId, active: 'active' }, type: QueryTypes.SELECT, transaction },
    );
    if (actor?.role !== UserRole.Admin) throw new AppException(ErrorCode.Forbidden);
  }

  private async load(): Promise<SettingValues> {
    return this.merge(await this.settingModel.findAll());
  }

  /**
   * Stored values over defaults. A stored value that no longer parses is
   * logged and replaced by its default; if the result breaks a rule across
   * keys (e.g. min distance above max), every default is used.
   */
  private merge(rows: AppSetting[]): SettingValues {
    const values = defaultSettings();
    for (const row of rows) {
      if (!isSettingKey(row.key)) continue;
      try {
        (values as Record<SettingKey, unknown>)[row.key] = parseSetting(row.key, row.value);
      } catch {
        this.logger.error({ key: row.key }, 'Stored setting is invalid; using the default');
      }
    }
    try {
      checkInvariants(values);
      return values;
    } catch {
      this.logger.error('Stored settings break a rule across keys; using every default');
      return defaultSettings();
    }
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** A cached object parsed key by key; null (a cache miss) if anything is off. */
function sanitize(raw: unknown): SettingValues | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  try {
    const out = Object.fromEntries(SETTING_KEYS.map((k) => [k, parseSetting(k, input[k])])) as SettingValues;
    checkInvariants(out);
    return out;
  } catch {
    return null;
  }
}

function changedFields(from: unknown, to: unknown): string[] {
  if (from && to && typeof from === 'object' && typeof to === 'object' && !Array.isArray(from) && !Array.isArray(to)) {
    const a = from as Record<string, unknown>;
    const b = to as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
  }
  return JSON.stringify(from) === JSON.stringify(to) ? [] : ['value'];
}
