import 'reflect-metadata';

import type { Redis } from 'ioredis';
import type { Sequelize } from 'sequelize-typescript';

import { fakeSecurityEvents } from '../auth/testing/fakes';
import { SecurityEventType } from '../security/models/security-event.model';
import type { AppSetting } from './models/app-setting.model';
import { SETTINGS_CACHE_KEY, SETTINGS_DEPENDENT_CACHE_KEYS } from './settings.cache';
import { checkInvariants, defaultSettings, parseSetting, SETTING_KEYS, SettingValueError } from './settings.registry';
import { SettingsService, UnknownSettingError } from './settings.service';

const ADMIN = 'admin-1';

function setup(rows: Array<{ key: string; value: unknown }> = [], roles: Record<string, string> = { [ADMIN]: 'admin' }) {
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
  const deleted: string[] = [];
  const redis = {
    mget: jest.fn(async (...keys: string[]) => keys.map((k) => cache.get(k) ?? null)),
    // SET_IF_GENERATION: write only if the generation is still the one read.
    eval: jest.fn(async (_s: string, _n: number, key: string, genKey: string, value: string, _ttl: number, gen: string) => {
      if ((cache.get(genKey) ?? '0') !== gen) return 0;
      cache.set(key, value);
      return 1;
    }),
    multi: jest.fn(() => {
      const chain = {
        incr: (k: string) => (cache.set(k, String(Number(cache.get(k) ?? '0') + 1)), chain),
        del: (...keys: string[]) => (keys.forEach((k) => (cache.delete(k), deleted.push(k))), chain),
        exec: async () => [],
      };
      return chain;
    }),
  };
  const tx = { LOCK: { UPDATE: 'UPDATE' } };
  const sequelize = {
    transaction: jest.fn((fn: (t: object) => Promise<unknown>) => fn(tx)),
    query: jest.fn(async (_sql: string, opts: { replacements: { id: string } }) => (roles[opts.replacements.id] ? [{ role: roles[opts.replacements.id] }] : [])),
  };
  const events = fakeSecurityEvents();
  const service = new SettingsService(model as unknown as typeof AppSetting, redis as unknown as Redis, events, sequelize as unknown as Sequelize);
  return { service, model, redis, cache, events, store, tx, deleted };
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
    ['app.support_links', { helpCenterUrl: 'https://user:pw@evil.example', privacyPolicyUrl: null, termsUrl: null, supportEmail: null }],
    ['app.support_links', { helpCenterUrl: 'https://localhost/help', privacyPolicyUrl: null, termsUrl: null, supportEmail: null }],
    ['app.support_links', { helpCenterUrl: 'https://10.0.0.1/help', privacyPolicyUrl: null, termsUrl: null, supportEmail: null }],
    ['app.support_links', JSON.parse('{"helpCenterUrl":null,"privacyPolicyUrl":null,"termsUrl":null,"supportEmail":null,"__proto__":{"x":1}}')],
    ['app.feature_flags', { voiceVideoCalls: true, contactExchange: false, idVerification: false, constructor: true }],
  ] as const)('%s rejects %j', (key, value) => {
    expect(() => parseSetting(key, value)).toThrow(SettingValueError);
  });

  it('support links accept an https URL on a public host, and normalise it', () => {
    expect(
      parseSetting('app.support_links', { helpCenterUrl: 'https://help.kuchupuchu.example/faq', privacyPolicyUrl: null, termsUrl: null, supportEmail: 'support@kuchupuchu.example' }),
    ).toMatchObject({ helpCenterUrl: 'https://help.kuchupuchu.example/faq' });
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
    expect(s.cache.has(SETTINGS_CACHE_KEY)).toBe(true);
    expect(s.redis.eval.mock.calls[0][5]).toBe(600);
  });

  it('a damaged or foreign cache entry is ignored (a limit can never come back undefined)', async () => {
    const s = setup([{ key: 'profile.max_interests', value: 7 }]);
    for (const bad of ['{"profile.max_interests":"lots"}', '{}', 'not json', '[]']) {
      s.cache.set(SETTINGS_CACHE_KEY, bad);
      await expect(s.service.get('profile.max_interests')).resolves.toBe(7);
    }
  });

  it('a read that started before set() never caches the old values again (generation counter)', async () => {
    const s = setup([{ key: 'app.maintenance', value: false }]);
    // The read loads the old row…
    s.model.findAll.mockImplementationOnce(async () => {
      // …while set() commits and invalidates in between.
      await s.service.set('app.maintenance', true, ADMIN);
      return [{ key: 'app.maintenance', value: false }];
    });
    await s.service.all();
    expect(s.cache.has(SETTINGS_CACHE_KEY)).toBe(false);
    await expect(s.service.get('app.maintenance')).resolves.toBe(true);
  });

  it('stored values that break a cross-key rule fall back to every default', async () => {
    const s = setup([
      { key: 'preferences.min_distance_km', value: 300 },
      { key: 'profile.max_interests', value: 7 },
    ]);
    await expect(s.service.all()).resolves.toEqual(defaultSettings());
  });

  it('a stored value that no longer parses falls back to the default', async () => {
    const s = setup([{ key: 'profile.max_interests', value: 'lots' }]);
    await expect(s.service.get('profile.max_interests')).resolves.toBe(10);
  });

  it('Redis down: reads still work from MySQL', async () => {
    const s = setup([{ key: 'app.maintenance', value: true }]);
    s.redis.mget.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(s.service.get('app.maintenance')).resolves.toBe(true);
  });

  it('set: validates under a lock on every row, writes, audits (admin.setting_changed, strict) and drops every dependent cache key', async () => {
    const s = setup([{ key: 'profile.max_interests', value: 10 }]);
    await s.service.get('profile.max_interests');
    await expect(s.service.set('profile.max_interests', 12, ADMIN)).resolves.toBe(12);
    expect(s.model.findAll).toHaveBeenCalledWith({ transaction: s.tx, lock: 'UPDATE' });
    expect(s.store.get('profile.max_interests')).toBe(12);
    expect(s.model.upsert).toHaveBeenCalledWith({ key: 'profile.max_interests', value: 12, updatedBy: ADMIN }, { transaction: s.tx });
    expect(s.events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: SecurityEventType.AdminSettingChanged,
        actorUserId: ADMIN,
        metadata: { key: 'profile.max_interests', from: 10, to: 12, changedFields: ['value'] },
        transaction: s.tx,
        strict: true,
      }),
    );
    expect(s.deleted).toEqual(SETTINGS_DEPENDENT_CACHE_KEYS);
    await expect(s.service.get('profile.max_interests')).resolves.toBe(12);
  });

  it('set: the audit names the changed fields of an object setting (supportEmail survives the PII key filter as a field name)', async () => {
    const s = setup();
    const links = { helpCenterUrl: null, privacyPolicyUrl: null, termsUrl: null, supportEmail: 'support@kuchupuchu.example' };
    await s.service.set('app.support_links', links, ADMIN);
    const [[event]] = s.events.record.mock.calls as [[{ metadata: { changedFields: string[] } }]];
    expect(event.metadata.changedFields).toEqual(['supportEmail']);
  });

  it('set: only an active admin, read from the database, may change settings → else 403 FORBIDDEN', async () => {
    const s = setup([], { 'mod-1': 'moderator', [ADMIN]: 'admin' });
    for (const actor of ['mod-1', 'nobody']) {
      await expect(s.service.set('app.maintenance', true, actor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(s.model.upsert).not.toHaveBeenCalled();
  });

  it('set: an invalid value or one that breaks a cross-key rule → 400 VALIDATION_ERROR, nothing written', async () => {
    const s = setup();
    await expect(s.service.set('preferences.max_distance_km', 0, ADMIN)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(s.service.set('profile.min_interests_for_completion', 20, ADMIN)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(s.service.set('preferences.min_distance_km', 250, ADMIN)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { errors: [{ field: 'preferences.min_distance_km', message: expect.stringContaining('must not exceed') }] },
    });
    expect(s.model.upsert).not.toHaveBeenCalled();
    expect(s.events.record).not.toHaveBeenCalled();
  });

  it('set with an unknown key is a programming error', async () => {
    const s = setup();
    await expect(s.service.set('nope' as never, 1, ADMIN)).rejects.toBeInstanceOf(UnknownSettingError);
  });

  it('boot: a stored key this build does not know fails the start', async () => {
    await expect(setup([{ key: 'likes.daily.free', value: 10 }]).service.onModuleInit()).rejects.toThrow('likes.daily.free');
    await expect(setup([{ key: 'app.maintenance', value: false }]).service.onModuleInit()).resolves.toBeUndefined();
  });
});
