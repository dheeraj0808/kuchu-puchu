import 'reflect-metadata';

import type { Redis } from 'ioredis';
import type { Sequelize } from 'sequelize-typescript';

import { fakeSecurityEvents } from '../auth/testing/fakes';
import { SecurityEventType } from '../security/models/security-event.model';
import type { AppSetting } from './models/app-setting.model';
import { SETTINGS_CACHE_KEY, SETTINGS_DEPENDENT_CACHE_KEYS } from './settings.cache';
import { checkInvariants, defaultSettings, parseSetting, SETTING_KEYS, SettingValueError } from './settings.registry';
import { SettingsService, UnknownSettingError } from './settings.service';

function setup(rows: Array<{ key: string; value: unknown }> = []) {
  const store = new Map(rows.map((r) => [r.key, r.value]));
  const model = {
    findAll: jest.fn(async () => [...store.entries()].map(([key, value]) => ({ key, value }))),
    findByPk: jest.fn(async (key: string) => (store.has(key) ? { key, value: store.get(key) } : null)),
    upsert: jest.fn(async (row: { key: string; value: unknown }) => {
      store.set(row.key, row.value);
      return [row, true];
    }),
  };
  const cache = new Map<string, string>();
  const redis = {
    get: jest.fn(async (k: string) => cache.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => (cache.set(k, v), 'OK')),
    del: jest.fn(async (...keys: string[]) => keys.filter((k) => cache.delete(k)).length),
  };
  const tx = { LOCK: { UPDATE: 'UPDATE' } };
  const sequelize = { transaction: jest.fn((fn: (t: object) => Promise<unknown>) => fn(tx)) };
  const events = fakeSecurityEvents();
  const service = new SettingsService(model as unknown as typeof AppSetting, redis as unknown as Redis, events, sequelize as unknown as Sequelize);
  return { service, model, redis, cache, events, store, tx };
}

describe('settings registry', () => {
  it('every key has a valid default, and the defaults satisfy the cross-key rules', () => {
    const defaults = defaultSettings();
    for (const key of SETTING_KEYS) expect(parseSetting(key, defaults[key])).toEqual(defaults[key]);
    expect(() => checkInvariants(defaults)).not.toThrow();
    expect(defaults).toMatchObject({
      'profile.max_interests': 10,
      'preferences.min_distance_km': 1,
      'preferences.max_distance_km': 200,
      'app.maintenance': false,
    });
  });

  it.each([
    ['profile.max_interests', 0],
    ['profile.max_interests', 10.5],
    ['profile.max_interests', '10'],
    ['app.maintenance', 'false'],
    ['app.min_version.ios', '1.0'],
    ['app.feature_flags', { voiceVideoCalls: true }],
    ['app.feature_flags', { voiceVideoCalls: true, contactExchange: false, idVerification: false, secret: true }],
    ['app.support_links', { helpCenterUrl: 'http://insecure.example', privacyPolicyUrl: null, termsUrl: null, supportEmail: null }],
  ] as const)('%s rejects %j', (key, value) => {
    expect(() => parseSetting(key, value)).toThrow(SettingValueError);
  });

  it('min distance above max, or a default outside them, breaks the cross-key rules', () => {
    expect(() => checkInvariants({ ...defaultSettings(), 'preferences.min_distance_km': 300 })).toThrow('must not exceed');
    expect(() => checkInvariants({ ...defaultSettings(), 'preferences.default_distance_km': 500 })).toThrow('between the min and max');
  });
});

describe('SettingsService', () => {
  it('get: stored values over defaults, cached in one Redis entry for 10 min', async () => {
    const s = setup([{ key: 'profile.max_interests', value: 7 }]);
    await expect(s.service.get('profile.max_interests')).resolves.toBe(7);
    await expect(s.service.get('preferences.max_distance_km')).resolves.toBe(200);
    expect(s.model.findAll).toHaveBeenCalledTimes(1);
    expect(s.redis.set).toHaveBeenCalledWith(SETTINGS_CACHE_KEY, expect.any(String), 'EX', 600);
  });

  it('a stored value that no longer parses falls back to the default', async () => {
    const s = setup([{ key: 'profile.max_interests', value: 'lots' }]);
    await expect(s.service.get('profile.max_interests')).resolves.toBe(10);
  });

  it('Redis down: reads still work from MySQL', async () => {
    const s = setup([{ key: 'app.maintenance', value: true }]);
    s.redis.get.mockRejectedValue(new Error('ECONNREFUSED'));
    s.redis.set.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(s.service.get('app.maintenance')).resolves.toBe(true);
  });

  it('set: validates, writes, audits (admin.setting_changed, strict) and drops every dependent cache key', async () => {
    const s = setup([{ key: 'profile.max_interests', value: 10 }]);
    await s.service.get('profile.max_interests');
    await expect(s.service.set('profile.max_interests', 12, 'admin-1')).resolves.toBe(12);
    expect(s.store.get('profile.max_interests')).toBe(12);
    expect(s.model.upsert).toHaveBeenCalledWith({ key: 'profile.max_interests', value: 12, updatedBy: 'admin-1' }, { transaction: s.tx });
    expect(s.events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: SecurityEventType.AdminSettingChanged,
        actorUserId: 'admin-1',
        metadata: { key: 'profile.max_interests', from: 10, to: 12 },
        transaction: s.tx,
        strict: true,
      }),
    );
    expect(s.redis.del).toHaveBeenCalledWith(...SETTINGS_DEPENDENT_CACHE_KEYS);
    await expect(s.service.get('profile.max_interests')).resolves.toBe(12);
  });

  it('set: an invalid value or one that breaks a cross-key rule → 400 VALIDATION_ERROR, nothing written', async () => {
    const s = setup();
    await expect(s.service.set('preferences.max_distance_km', 0, null)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(s.service.set('preferences.min_distance_km', 250, null)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { errors: [{ field: 'preferences.min_distance_km', message: expect.stringContaining('must not exceed') }] },
    });
    expect(s.model.upsert).not.toHaveBeenCalled();
    expect(s.events.record).not.toHaveBeenCalled();
  });

  it('set with an unknown key is a programming error', async () => {
    const s = setup();
    await expect(s.service.set('nope' as never, 1, null)).rejects.toBeInstanceOf(UnknownSettingError);
  });

  it('boot: a stored key this build does not know fails the start', async () => {
    await expect(setup([{ key: 'likes.daily.free', value: 10 }]).service.onModuleInit()).rejects.toThrow('likes.daily.free');
    await expect(setup([{ key: 'app.maintenance', value: false }]).service.onModuleInit()).resolves.toBeUndefined();
  });
});
