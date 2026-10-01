import type { NestExpressApplication } from '@nestjs/platform-express';
import { getConnectionToken } from '@nestjs/sequelize';
import type { Redis } from 'ioredis';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import request from 'supertest';

import { PROMPT_SEED } from '../../src/catalog/prompts.seed';
import { runSeeders } from '../../src/database/seeders';
import { REDIS_CLIENT } from '../../src/infra/redis/redis.module';
import { INTEREST_SEED } from '../../src/interests/interests.seed';
import { Gender } from '../../src/profiles/models/profile.model';
import { ProfilesService } from '../../src/profiles/profiles.service';
import { RelationshipIntent } from '../../src/preferences/models/dating-preference.model';
import { APP_CONFIG_CACHE_KEY, SETTINGS_CACHE_KEY } from '../../src/settings/settings.cache';
import { defaultSettings, SETTING_KEYS } from '../../src/settings/settings.registry';
import { SettingsService } from '../../src/settings/settings.service';
import { UsersService } from '../../src/users/users.service';
import { IdentifierType } from '../../src/auth/models/otp-verification.model';
import { ctx, freshIp, login, uniqueEmail } from '../support/auth-helpers';
import { createTestApp } from '../support/test-app';

describe('M08 Catalogue & App Config (MySQL 8.4 + Redis)', () => {
  let app: NestExpressApplication;
  let sequelize: Sequelize;
  let redis: Redis;
  let server: ReturnType<NestExpressApplication['getHttpServer']>;
  let settings: SettingsService;
  let adminId: string;

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    sequelize = app.get<Sequelize>(getConnectionToken());
    redis = app.get<Redis>(REDIS_CLIENT);
    server = app.getHttpServer();
    settings = app.get(SettingsService);
    // set() re-reads the actor's role: only an active admin may change settings.
    const { user } = await app.get(UsersService).createVerified(IdentifierType.Email, uniqueEmail('admin'));
    await sequelize.query(`UPDATE users SET role = 'admin' WHERE id = :id`, { replacements: { id: user.id } });
    adminId = user.id;
  });

  afterEach(async () => {
    // Every test starts from the seeded defaults.
    const defaults = defaultSettings();
    for (const key of SETTING_KEYS) {
      await sequelize.query('UPDATE app_settings SET value = CAST(:value AS JSON), updated_by = NULL WHERE `key` = :key', {
        replacements: { key, value: JSON.stringify(defaults[key]) },
      });
    }
    await settings.invalidate();
  });

  afterAll(async () => {
    await app?.close();
  });

  const select = <T extends object>(sql: string, replacements: Record<string, unknown> = {}): Promise<T[]> =>
    sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT });

  const get = (path: string, token?: string): request.Test => {
    const req = request(server).get(`/api/v1${path}`).set('X-Forwarded-For', freshIp());
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  describe('tables', () => {
    const columns = async (table: string) =>
      Object.fromEntries(
        (
          await select<{ name: string; type: string; nullable: string; key: string }>(
            `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_KEY AS \`key\` FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table ORDER BY ORDINAL_POSITION`,
            { table },
          )
        ).map((c) => [c.name, `${c.type}${c.nullable === 'YES' ? ' NULL' : ''}${c.key === 'PRI' ? ' PK' : ''}`]),
      );

    it('interests matches the spec (name / slug VARCHAR(50), slug unique, category, icon, is_active, sort_order)', async () => {
      expect(await columns('interests')).toEqual({
        id: 'char(36) PK',
        name: 'varchar(50)',
        slug: 'varchar(50)',
        is_active: 'tinyint(1)',
        created_at: 'datetime(3)',
        updated_at: 'datetime(3)',
        category: 'varchar(30)',
        icon: 'varchar(50)',
        sort_order: 'smallint',
      });
      const [unique] = await select<{ n: number }>(
        `SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'interests' AND COLUMN_NAME = 'slug' AND NON_UNIQUE = 0`,
      );
      expect(Number(unique.n)).toBe(1);
    });

    it('prompts matches the spec (+ standard columns)', async () => {
      expect(await columns('prompts')).toEqual({
        id: 'char(36) PK',
        text: 'varchar(150)',
        category: 'varchar(30)',
        is_active: 'tinyint(1)',
        sort_order: 'smallint',
        created_at: 'datetime(3)',
        updated_at: 'datetime(3)',
      });
    });

    it('app_settings is exactly the spec: key PK, value JSON, updated_by, updated_at (no id, no created_at)', async () => {
      expect(await columns('app_settings')).toEqual({
        key: 'varchar(64) PK',
        value: 'json',
        updated_by: 'char(36) NULL',
        updated_at: 'datetime(3)',
      });
    });
  });

  describe('seeders', () => {
    it('are idempotent: a second run inserts nothing and duplicates nothing', async () => {
      await runSeeders(sequelize);
      const counts = async () => ({
        interests: Number((await select<{ n: number }>('SELECT COUNT(*) AS n FROM interests'))[0].n),
        prompts: Number((await select<{ n: number }>('SELECT COUNT(*) AS n FROM prompts'))[0].n),
        settings: Number((await select<{ n: number }>('SELECT COUNT(*) AS n FROM app_settings'))[0].n),
      });
      const before = await counts();
      const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      await runSeeders(sequelize);
      expect(await counts()).toEqual(before);
      expect(log.mock.calls.map((c) => c[0])).toEqual([
        `[M08] interests seeder: 0 inserted, 0 updated, ${INTEREST_SEED.length} unchanged`,
        `[M08] prompts seeder: 0 inserted, 0 updated, ${PROMPT_SEED.length} unchanged`,
        `[M08] app_settings seeder: 0 inserted, ${SETTING_KEYS.length} kept`,
      ]);
      log.mockRestore();
      expect(before.prompts).toBeGreaterThanOrEqual(20);
      expect(before.settings).toBe(SETTING_KEYS.length);
    });

    it('upsert: catalogue rows follow the seed list, but a retired interest stays retired and an admin setting is kept', async () => {
      await sequelize.query(`UPDATE interests SET category = 'wrong', is_active = 0 WHERE slug = 'music'`);
      await sequelize.query(`UPDATE app_settings SET value = CAST('7' AS JSON) WHERE \`key\` = 'profile.max_interests'`);
      jest.spyOn(console, 'log').mockImplementation(() => undefined);
      await runSeeders(sequelize);
      const [music] = await select<{ category: string; is_active: number }>(`SELECT category, is_active FROM interests WHERE slug = 'music'`);
      expect(music).toEqual({ category: 'arts', is_active: 0 });
      const [max] = await select<{ value: unknown }>(`SELECT value FROM app_settings WHERE \`key\` = 'profile.max_interests'`);
      expect(max.value).toBe(7);
      await sequelize.query(`UPDATE interests SET is_active = 1 WHERE slug = 'music'`);
    });
  });

  describe('catalogue', () => {
    it('GET /catalog/interests: active interests grouped by category, in sort order; needs a token', async () => {
      await get('/catalog/interests').expect(401);
      const s = await login(app, uniqueEmail('catalog'));
      await sequelize.query(`UPDATE interests SET is_active = 0 WHERE slug = 'gaming'`);
      await settings.invalidate();
      try {
        const groups = (await get('/catalog/interests', s.accessToken).expect(200)).body.data as Array<{
          category: string;
          interests: Array<{ slug: string; icon: string }>;
        }>;
        expect(groups.map((g) => g.category)).toEqual(['lifestyle', 'arts', 'sports', 'outdoors', 'tech']);
        expect(groups[0].interests[0]).toEqual({ id: expect.any(String), name: 'Travel', slug: 'travel', category: 'lifestyle', icon: 'plane' });
        const slugs = groups.flatMap((g) => g.interests.map((i) => i.slug));
        expect(slugs).not.toContain('gaming');
        expect(slugs).toContain('music');
      } finally {
        await sequelize.query(`UPDATE interests SET is_active = 1 WHERE slug = 'gaming'`);
      }
    });

    it('GET /catalog/prompts: about 20 active prompts in order; needs a token', async () => {
      await get('/catalog/prompts').expect(401);
      const s = await login(app, uniqueEmail('prompts'));
      const prompts = (await get('/catalog/prompts', s.accessToken).expect(200)).body.data as Array<{ text: string; category: string }>;
      expect(prompts.length).toBeGreaterThanOrEqual(20);
      expect(prompts[0]).toEqual({ id: expect.any(String), text: 'My perfect Sunday is…', category: 'about_me' });
    });

    it('the old GET /interests route is gone', async () => {
      const s = await login(app, uniqueEmail('oldroute'));
      expect((await get('/interests', s.accessToken).expect(404)).body.code).toBe('NOT_FOUND');
    });
  });

  describe('app config and settings', () => {
    it('GET /app/config works without a token and shows only the public settings', async () => {
      const res = await get('/app/config').expect(200);
      expect(res.body.data).toEqual({
        minVersion: { android: '1.0.0', ios: '1.0.0' },
        maintenance: false,
        featureFlags: { voiceVideoCalls: false, contactExchange: false, idVerification: false },
        supportLinks: { helpCenterUrl: null, privacyPolicyUrl: null, termsUrl: null, supportEmail: null },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/max_interests|distance/);
    });

    it('a changed setting is served from the cache until set() invalidates it; then everyone sees it', async () => {
      await get('/app/config').expect(200);
      expect(await redis.get(APP_CONFIG_CACHE_KEY)).not.toBeNull();
      // A change that bypasses set() is not seen while the cache lives…
      await sequelize.query(`UPDATE app_settings SET value = CAST('true' AS JSON) WHERE \`key\` = 'app.maintenance'`);
      expect((await get('/app/config').expect(200)).body.data.maintenance).toBe(false);
      // …set() writes, audits and drops the caches.
      await settings.set('app.min_version.android', '1.4.0', adminId);
      const after = (await get('/app/config').expect(200)).body.data;
      expect(after).toMatchObject({ maintenance: true, minVersion: { android: '1.4.0', ios: '1.0.0' } });
      expect(await redis.ttl(APP_CONFIG_CACHE_KEY)).toBeGreaterThan(590);
      const [event] = await select<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM security_events WHERE event_type = 'admin.setting_changed' ORDER BY id DESC LIMIT 1`,
      );
      expect(event.metadata).toEqual({ key: 'app.min_version.android', from: '1.0.0', to: '1.4.0', changedFields: ['value'] });
    });

    it('only an active admin can change a setting (role read from the database) → else 403 FORBIDDEN', async () => {
      const s = await login(app, uniqueEmail('notadmin'));
      await expect(settings.set('app.maintenance', true, s.userId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await settings.get('app.maintenance')).toBe(false);
    });

    it('GET /app/config: its own per-IP limit (60/min) and a one-minute client cache header', async () => {
      const ip = freshIp();
      const first = await request(server).get('/api/v1/app/config').set('X-Forwarded-For', ip).expect(200);
      expect(first.headers['cache-control']).toBe('public, max-age=60');
      for (let i = 1; i < 60; i++) await request(server).get('/api/v1/app/config').set('X-Forwarded-For', ip).expect(200);
      const limited = await request(server).get('/api/v1/app/config').set('X-Forwarded-For', ip).expect(429);
      expect(limited.body.code).toBe('TOO_MANY_REQUESTS');
    });

    it('an invalid value is rejected (400 VALIDATION_ERROR) and nothing changes', async () => {
      for (const [key, value] of [
        ['preferences.max_distance_km', -1],
        ['app.maintenance', 'yes'],
        ['app.min_version.ios', 'latest'],
        ['preferences.min_distance_km', 500],
      ] as const) {
        await expect(settings.set(key, value, adminId)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      }
      expect(await settings.get('preferences.max_distance_km')).toBe(200);
      expect(await settings.get('app.maintenance')).toBe(false);
    });

    it('a stored key this build does not know fails the boot', async () => {
      await sequelize.query(`INSERT INTO app_settings (\`key\`, value, updated_at) VALUES ('likes.daily.free', CAST('10' AS JSON), NOW(3))`);
      try {
        await expect(settings.onModuleInit()).rejects.toThrow('likes.daily.free');
      } finally {
        await sequelize.query(`DELETE FROM app_settings WHERE \`key\` = 'likes.daily.free'`);
      }
      await expect(settings.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('limits read through SettingsService', () => {
    const prefs = (maxDistanceKm: number) => ({
      minAge: 25,
      maxAge: 35,
      preferredGenders: [Gender.Woman],
      maxDistanceKm,
      relationshipIntent: RelationshipIntent.LongTerm,
    });

    it('preferences reject a distance over 200 (preferences.max_distance_km)', async () => {
      const s = await login(app, uniqueEmail('dist'));
      const res = await request(server)
        .post('/api/v1/preferences')
        .set('X-Forwarded-For', freshIp())
        .set('Authorization', `Bearer ${s.accessToken}`)
        .send(prefs(201))
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(res.body.details)).toContain('between 1 and 200');
      await request(server)
        .post('/api/v1/preferences')
        .set('X-Forwarded-For', freshIp())
        .set('Authorization', `Bearer ${s.accessToken}`)
        .send(prefs(200))
        .expect(201);
    });

    it('profile.max_interests changes take effect after set()', async () => {
      const s = await login(app, uniqueEmail('maxint'));
      await app.get(ProfilesService).create(s.userId, { displayName: 'Ravi Kumar', dateOfBirth: '1994-02-03', gender: Gender.Man }, ctx);
      const ids = (await select<{ id: string }>('SELECT id FROM interests WHERE is_active = 1 ORDER BY sort_order LIMIT 3')).map((r) => r.id);
      const put = () =>
        request(server)
          .put('/api/v1/profile/interests')
          .set('X-Forwarded-For', freshIp())
          .set('Authorization', `Bearer ${s.accessToken}`)
          .send({ interestIds: ids });
      expect((await put().expect(200)).body.data.maxInterests).toBe(10);
      await settings.set('profile.max_interests', 2, adminId);
      expect((await put().expect(400)).body.code).toBe('VALIDATION_ERROR');
      expect(await redis.get(SETTINGS_CACHE_KEY)).not.toBeNull();
    });
  });
});
