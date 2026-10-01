import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import type { Redis } from 'ioredis';
import type { Sequelize } from 'sequelize-typescript';

import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import { errorClassOf } from '../infra/alerts/alert.provider';
import { REDIS_CLIENT } from '../infra/redis/redis.module';
import { SecurityEventType } from '../security/models/security-event.model';
import { SecurityEventsService } from '../security/security-events.service';
import { AppSetting } from './models/app-setting.model';
import { SETTINGS_CACHE_KEY, SETTINGS_CACHE_TTL_SECONDS, SETTINGS_DEPENDENT_CACHE_KEYS } from './settings.cache';
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

/**
 * Runtime settings (guide M08). Reads go through one Redis entry holding
 * every value (10 min), falling back to MySQL and then to the registry
 * defaults. set() validates, writes, audits and drops every dependent cache
 * key, so the change is visible on the next read on any instance.
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

  /** An unknown key in app_settings fails the boot: the code and the data disagree. */
  async onModuleInit(): Promise<void> {
    const rows = await this.settingModel.findAll({ attributes: ['key'] });
    const unknown = rows.map((r) => r.key).filter((k) => !isSettingKey(k));
    if (unknown.length > 0) throw new UnknownSettingError(`app_settings has keys this build does not know: ${unknown.join(', ')}`);
  }

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    return (await this.all())[key];
  }

  /** Every setting, stored values over defaults. */
  async all(): Promise<SettingValues> {
    try {
      const cached = await this.redis.get(SETTINGS_CACHE_KEY);
      if (cached) return JSON.parse(cached) as SettingValues;
    } catch (err) {
      this.logger.warn({ err: errorClassOf(err) }, 'Settings cache read failed; using the database');
    }
    const values = await this.load();
    await this.redis.set(SETTINGS_CACHE_KEY, JSON.stringify(values), 'EX', SETTINGS_CACHE_TTL_SECONDS).catch(() => undefined);
    return values;
  }

  /**
   * Validates the value (and the rules across keys), writes it, records an
   * admin.setting_changed event and drops the caches. Invalid → 400
   * VALIDATION_ERROR. Used by M15's PUT /admin/settings/:key.
   */
  async set<K extends SettingKey>(key: K, value: unknown, actorUserId: string | null): Promise<SettingValue<K>> {
    if (!isSettingKey(key)) throw new UnknownSettingError(`Unknown setting "${String(key)}"`);
    let parsed: SettingValue<K>;
    try {
      parsed = parseSetting(key, value);
      checkInvariants({ ...(await this.load()), [key]: parsed });
    } catch (err) {
      if (!(err instanceof SettingValueError)) throw err;
      throw new AppException(ErrorCode.ValidationError, { errors: [{ field: key, message: err.message }] });
    }
    await this.sequelize.transaction(async (transaction) => {
      const previous = await this.settingModel.findByPk(key, { transaction, lock: transaction.LOCK.UPDATE });
      await this.settingModel.upsert({ key, value: parsed, updatedBy: actorUserId }, { transaction });
      await this.securityEvents.record({
        eventType: SecurityEventType.AdminSettingChanged,
        actorUserId,
        // Settings hold no PII; keep the before/after for the audit log.
        metadata: { key, from: previous?.value ?? null, to: parsed },
        transaction,
        strict: true,
      });
    });
    await this.invalidate();
    return parsed;
  }

  /** Drops the settings, app config and catalogue caches. */
  async invalidate(): Promise<void> {
    try {
      await this.redis.del(...SETTINGS_DEPENDENT_CACHE_KEYS);
    } catch (err) {
      this.logger.error({ err: errorClassOf(err) }, 'Settings cache delete failed; values refresh within 10 minutes');
    }
  }

  /** Stored values over defaults. A stored value that no longer parses is logged and replaced by the default. */
  private async load(): Promise<SettingValues> {
    const values = defaultSettings();
    const rows = await this.settingModel.findAll();
    for (const row of rows) {
      if (!isSettingKey(row.key)) continue;
      try {
        (values as Record<SettingKey, unknown>)[row.key] = parseSetting(row.key, row.value);
      } catch {
        this.logger.error({ key: row.key }, 'Stored setting is invalid; using the default');
      }
    }
    return values;
  }

  /** For tests and tools. */
  static keys(): readonly SettingKey[] {
    return SETTING_KEYS;
  }
}
