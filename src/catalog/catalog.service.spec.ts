import 'reflect-metadata';

import type { Redis } from 'ioredis';

import type { Interest } from '../interests/models/interest.model';
import { APP_CONFIG_CACHE_KEY, CATALOG_INTERESTS_CACHE_KEY } from '../settings/settings.cache';
import { fakeSettings } from '../settings/testing/fake-settings';
import { CatalogService } from './catalog.service';
import type { Prompt } from './models/prompt.model';

const interest = (slug: string, category: string, sortOrder: number) =>
  ({ id: `id-${slug}`, name: slug.toUpperCase(), slug, category, icon: 'star', sortOrder, isActive: true }) as unknown as Interest;

function setup() {
  const cache = new Map<string, string>();
  const redis = {
    get: jest.fn(async (k: string) => cache.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => (cache.set(k, v), 'OK')),
  };
  const interestModel = { findAll: jest.fn().mockResolvedValue([interest('travel', 'lifestyle', 10), interest('music', 'arts', 20), interest('food', 'lifestyle', 30)]) };
  const promptModel = { findAll: jest.fn().mockResolvedValue([{ id: 'p1', text: 'My perfect Sunday is…', category: 'about_me', sortOrder: 10 }]) };
  const settings = fakeSettings({ 'app.maintenance': true, 'app.min_version.ios': '2.0.0', 'profile.max_interests': 7 });
  const service = new CatalogService(
    interestModel as unknown as typeof Interest,
    promptModel as unknown as typeof Prompt,
    settings,
    redis as unknown as Redis,
  );
  return { service, cache, redis, interestModel, promptModel };
}

describe('CatalogService', () => {
  it('interests: active only, grouped by category in first-seen sort order, cached 10 min', async () => {
    const s = setup();
    const groups = await s.service.interests();
    expect(s.interestModel.findAll).toHaveBeenCalledWith({ where: { isActive: true }, order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
    expect(groups.map((g) => [g.category, g.interests.map((i) => i.slug)])).toEqual([
      ['lifestyle', ['travel', 'food']],
      ['arts', ['music']],
    ]);
    expect(s.redis.set).toHaveBeenCalledWith(CATALOG_INTERESTS_CACHE_KEY, expect.any(String), 'EX', 600);
    await s.service.interests();
    expect(s.interestModel.findAll).toHaveBeenCalledTimes(1);
  });

  it('prompts: id, text and category only', async () => {
    await expect(setup().service.prompts()).resolves.toEqual([{ id: 'p1', text: 'My perfect Sunday is…', category: 'about_me' }]);
  });

  it('app config: exactly the public fields, never a limit', async () => {
    const config = await setup().service.appConfig();
    expect(Object.keys(config).sort()).toEqual(['featureFlags', 'maintenance', 'minVersion', 'supportLinks']);
    expect(config).toMatchObject({ maintenance: true, minVersion: { android: '1.0.0', ios: '2.0.0' } });
    expect(JSON.stringify(config)).not.toContain('max_interests');
  });

  it('a cache entry of the wrong shape is treated as a miss', async () => {
    const s = setup();
    s.cache.set(APP_CONFIG_CACHE_KEY, JSON.stringify({ maintenance: 'yes', extra: 1 }));
    s.cache.set(CATALOG_INTERESTS_CACHE_KEY, JSON.stringify({ not: 'an array' }));
    expect((await s.service.appConfig()).maintenance).toBe(true);
    expect(Array.isArray(await s.service.interests())).toBe(true);
  });

  it('Redis down: served from MySQL', async () => {
    const s = setup();
    s.redis.get.mockRejectedValue(new Error('ECONNREFUSED'));
    s.redis.set.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(s.service.prompts()).resolves.toHaveLength(1);
  });
});
