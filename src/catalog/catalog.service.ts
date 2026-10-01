import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import type { Redis } from 'ioredis';

import { errorClassOf } from '../infra/alerts/alert.provider';
import { REDIS_CLIENT } from '../infra/redis/redis.module';
import { InterestResponse } from '../interests/dto/interest.response';
import { Interest } from '../interests/models/interest.model';
import {
  APP_CONFIG_CACHE_KEY,
  CATALOG_INTERESTS_CACHE_KEY,
  CATALOG_PROMPTS_CACHE_KEY,
  SETTINGS_CACHE_TTL_SECONDS,
} from '../settings/settings.cache';
import { SettingsService } from '../settings/settings.service';
import type { AppConfigResponse, InterestCategoryResponse, PromptResponse } from './dto/catalog.responses';
import { Prompt } from './models/prompt.model';

/**
 * Read-mostly reference data and the public app config (guide M08). Each
 * response is cached in Redis for 10 minutes; SettingsService.set() drops the
 * keys. Redis down → served from MySQL.
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    @InjectModel(Interest) private readonly interestModel: typeof Interest,
    @InjectModel(Prompt) private readonly promptModel: typeof Prompt,
    private readonly settings: SettingsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Active interests grouped by category; categories and items in sort order. */
  interests(): Promise<InterestCategoryResponse[]> {
    return this.cached(CATALOG_INTERESTS_CACHE_KEY, Array.isArray, async () => {
      const rows = await this.interestModel.findAll({
        where: { isActive: true },
        order: [
          ['sortOrder', 'ASC'],
          ['name', 'ASC'],
        ],
      });
      const groups = new Map<string, InterestResponse[]>();
      for (const row of rows) groups.set(row.category, [...(groups.get(row.category) ?? []), InterestResponse.fromModel(row)]);
      return [...groups.entries()].map(([category, interests]) => ({ category, interests }));
    });
  }

  prompts(): Promise<PromptResponse[]> {
    return this.cached(CATALOG_PROMPTS_CACHE_KEY, Array.isArray, async () => {
      const rows = await this.promptModel.findAll({
        where: { isActive: true },
        order: [
          ['sortOrder', 'ASC'],
          ['text', 'ASC'],
        ],
      });
      return rows.map((p) => ({ id: p.id, text: p.text, category: p.category }));
    });
  }

  /**
   * Public settings only, by this fixed list: versions, maintenance, public
   * feature flags, support links. Nothing else from the registry is shown.
   */
  appConfig(): Promise<AppConfigResponse> {
    return this.cached(APP_CONFIG_CACHE_KEY, isAppConfig, async () => {
      const s = await this.settings.all();
      return {
        minVersion: { android: s['app.min_version.android'], ios: s['app.min_version.ios'] },
        maintenance: s['app.maintenance'],
        featureFlags: s['app.feature_flags'],
        supportLinks: s['app.support_links'],
      };
    });
  }

  /** A cached value that does not have the expected shape counts as a miss. */
  private async cached<T>(key: string, isValid: (value: unknown) => boolean, load: () => Promise<T>): Promise<T> {
    try {
      const hit = await this.redis.get(key);
      if (hit) {
        const value: unknown = JSON.parse(hit);
        if (isValid(value)) return value as T;
      }
    } catch (err) {
      this.logger.warn({ err: errorClassOf(err) }, 'Catalogue cache read failed; using the database');
    }
    const value = await load();
    await this.redis.set(key, JSON.stringify(value), 'EX', SETTINGS_CACHE_TTL_SECONDS).catch(() => undefined);
    return value;
  }
}

const APP_CONFIG_KEYS = ['featureFlags', 'maintenance', 'minVersion', 'supportLinks'];

function isAppConfig(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(APP_CONFIG_KEYS) &&
    typeof (value as AppConfigResponse).maintenance === 'boolean'
  );
}
