import { randomUUID } from 'node:crypto';

import { Global, Module } from '@nestjs/common';
import type { INestApplicationContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { getConnectionToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import request from 'supertest';

import { DataExportExpiryJob, AccountWorkerModule } from '../../src/account/account-worker.module';
import { deletionMailKey, exportFileKey } from '../../src/account/account.constants';
import { AccountService } from '../../src/account/account.service';
import { AccountExportRegistry, AccountRegistryModule } from '../../src/account/registry/account-registry';
import { IdentifierType, OtpPurpose } from '../../src/auth/models/otp-verification.model';
import { otpCooldownKey, OtpService } from '../../src/auth/services/otp.service';
import { readZip } from '../../src/common/utils/zip';
import { CoreModule } from '../../src/core.module';
import { up as nullDeletedIdentifiers } from '../../src/database/migrations/20261008000001-users-null-deleted-identifiers';
import type { EventType } from '../../src/events/event-types';
import { HandlerRegistry } from '../../src/events/handler-registry';
import { EmailModule } from '../../src/infra/email/email.module';
import { EmailProvider } from '../../src/infra/email/email.provider';
import type { FakeEmailProvider } from '../../src/infra/email/fake-email.provider';
import { REDIS_CLIENT } from '../../src/infra/redis/redis.module';
import { LocalStorageProvider } from '../../src/infra/storage/local-storage.provider';
import { StorageModule } from '../../src/infra/storage/storage.module';
import { StorageProvider } from '../../src/infra/storage/storage.provider';
import { PeriodicJobRegistry } from '../../src/jobs/periodic-job';
import { Gender } from '../../src/profiles/models/profile.model';
import { ProfileDeletionHandler } from '../../src/profiles/account-hooks';
import { ProfilesService } from '../../src/profiles/profiles.service';
import { RelationshipIntent } from '../../src/preferences/models/dating-preference.model';
import { PreferencesService } from '../../src/preferences/preferences.service';
import { SecurityEventsExportContributor } from '../../src/security/account-hooks';
import { SecurityModule } from '../../src/security/security.module';
import { UserStatus } from '../../src/users/models/user.model';
import { UsersService } from '../../src/users/users.service';
import { ctx, freshIp, indianMobile, lastCode, login, newDevice, openSession, type SignedIn, uniqueEmail } from '../support/auth-helpers';
import { rememberSecret } from '../support/log-capture';
import { createTestApp } from '../support/test-app';

/** The worker's registries without its BullMQ relay and scheduler: the test delivers events itself. */
@Global()
@Module({ providers: [HandlerRegistry, PeriodicJobRegistry], exports: [HandlerRegistry, PeriodicJobRegistry] })
class TestWorkerRegistries {}

describe('M07 Account (MySQL 8.4 + Redis)', () => {
  let app: NestExpressApplication;
  let worker: INestApplicationContext;
  let sequelize: Sequelize;
  let redis: Redis;
  let server: ReturnType<NestExpressApplication['getHttpServer']>;
  let workerEmail: FakeEmailProvider;

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    sequelize = app.get<Sequelize>(getConnectionToken());
    redis = app.get<Redis>(REDIS_CLIENT);
    server = app.getHttpServer();
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule, TestWorkerRegistries, SecurityModule, EmailModule, StorageModule, AccountRegistryModule, AccountWorkerModule],
    }).compile();
    worker = await moduleRef.init();
    workerEmail = worker.get(EmailProvider) as FakeEmailProvider;
    const send = workerEmail.send.bind(workerEmail);
    workerEmail.send = async (message) => {
      rememberSecret(message.to);
      return send(message);
    };
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  afterEach(() => jest.restoreAllMocks());

  const select = <T extends object>(sql: string, replacements: Record<string, unknown> = {}): Promise<T[]> =>
    sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT });

  const authed = (method: 'get' | 'post' | 'delete', path: string, token: string): request.Test =>
    request(server)[method](`/api/v1${path}`).set('X-Forwarded-For', freshIp()).set('Authorization', `Bearer ${token}`);

  /** Delivers the pending outbox events of `type` for the aggregate to the worker's handlers, like the relay would. */
  async function deliver(type: EventType, aggregateId: string, attempt = 1): Promise<number> {
    const rows = await select<{ id: string; payload: Record<string, unknown> }>(
      `SELECT id, payload FROM outbox_events WHERE event_type = :type AND aggregate_id = :aggregateId AND status = 'pending' ORDER BY id`,
      { type, aggregateId },
    );
    for (const row of rows) {
      for (const handler of worker.get(HandlerRegistry).handlersFor(type)) {
        await handler.handle({ outboxId: String(row.id), type, aggregateId, payload: row.payload as never, attempt });
      }
      await sequelize.query(`UPDATE outbox_events SET status = 'done' WHERE id = :id`, { replacements: { id: row.id } });
    }
    return rows.length;
  }

  /** Lets another sign-in code be requested now (the 60 s cooldown passing). */
  async function clearCooldown(identifier: string): Promise<void> {
    const type = identifier.includes('@') ? IdentifierType.Email : IdentifierType.Phone;
    await redis.del(otpCooldownKey(OtpPurpose.Login, app.get(OtpService).rateLimitHash(type, identifier)));
  }

  async function stepUp(s: SignedIn, identifier: string): Promise<void> {
    await authed('post', '/auth/reauth/request', s.accessToken).send({}).expect(200);
    await authed('post', '/auth/reauth/verify', s.accessToken).send({ otp: lastCode(app, identifier) }).expect(200);
  }

  /** A signed-in user with a profile, two interests and preferences. */
  async function richUser(identifier: string): Promise<SignedIn> {
    const s = await login(app, identifier);
    await app.get(ProfilesService).create(s.userId, { displayName: 'Asha Rao', dateOfBirth: '1995-04-12', gender: Gender.Woman, bio: 'Chai and long walks' }, ctx);
    const interests = await select<{ id: string }>('SELECT id FROM interests ORDER BY id LIMIT 2');
    await app.get(ProfilesService).replaceOwnInterests(s.userId, interests.map((i) => i.id));
    await app.get(PreferencesService).create(s.userId, {
      minAge: 25,
      maxAge: 35,
      preferredGenders: [Gender.Man],
      maxDistanceKm: 50,
      relationshipIntent: RelationshipIntent.LongTerm,
    });
    return s;
  }

  const userRow = (id: string) =>
    select<{ email: string | null; phone: string | null; status: string; deleted_at: Date | null }>(
      'SELECT email, phone, status, deleted_at FROM users WHERE id = :id',
      { id },
    ).then((r) => r[0]);

  const countOf = async (sql: string, replacements: Record<string, unknown>) => Number((await select<{ n: number }>(sql, replacements))[0].n);

  describe('tables', () => {
    const columns = async (table: string) =>
      Object.fromEntries(
        (
          await select<{ name: string; type: string; nullable: string }>(
            `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table ORDER BY ORDINAL_POSITION`,
            { table },
          )
        ).map((c) => [c.name, `${c.type}${c.nullable === 'YES' ? ' NULL' : ''}`]),
      );
    const indexes = async (table: string) =>
      select<{ cols: string; non_unique: number }>(
        `SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols, MAX(NON_UNIQUE) AS non_unique FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND INDEX_NAME <> 'PRIMARY' GROUP BY INDEX_NAME ORDER BY cols`,
        { table },
      );

    it('data_export_requests is exactly the spec (+ standard columns, (user_id, created_at))', async () => {
      expect(await columns('data_export_requests')).toEqual({
        id: 'char(36)',
        user_id: 'char(36)',
        status: "enum('pending','processing','ready','expired','failed')",
        file_key: 'varchar(200) NULL',
        expires_at: 'datetime(3) NULL',
        completed_at: 'datetime(3) NULL',
        created_at: 'datetime(3)',
        updated_at: 'datetime(3)',
      });
      expect((await indexes('data_export_requests')).map((i) => i.cols)).toEqual(['user_id,created_at']);
    });

    it('ban_hashes is exactly the M15 spec (+ standard columns, unique (hash_type, hash))', async () => {
      expect(await columns('ban_hashes')).toEqual({
        id: 'char(36)',
        hash_type: "enum('identifier','photo','device')",
        hash: 'char(64)',
        source_user_id: 'char(36) NULL',
        created_at: 'datetime(3)',
        updated_at: 'datetime(3)',
      });
      expect(await indexes('ban_hashes')).toEqual([{ cols: 'hash_type,hash', non_unique: 0 }]);
    });
  });

  describe('deletion', () => {
    it('DELETE /account: every module hook runs, identifiers are nulled, the response has the store notice', async () => {
      const email = uniqueEmail('del');
      const s = await richUser(email);
      const other = await openSession(app, s.userId);
      await authed('get', '/auth/me', other.accessToken).expect(200); // cached session state
      await stepUp(s, email);

      const res = await authed('delete', '/account', s.accessToken).expect(200);
      expect(res.body.data).toEqual({
        message: 'Account deleted',
        storeSubscriptionNotice: expect.stringMatching(/Google Play or the App Store.*Cancel them in the store/),
      });

      expect(await userRow(s.userId)).toMatchObject({ email: null, phone: null, status: 'deactivated', deleted_at: expect.any(Date) });
      const sessions = await select<{ revoked_reason: string; ip_address: string; user_agent: string; device_id: string; device_name: string; refresh_token_hash: string }>(
        'SELECT revoked_reason, ip_address, user_agent, device_id, device_name, refresh_token_hash FROM sessions WHERE user_id = :u',
        { u: s.userId },
      );
      expect(sessions.map((r) => r.revoked_reason)).toEqual(['deleted', 'deleted']);
      // Scrubbed: no IP, user agent, device id or name, and token hashes no token can match.
      for (const row of sessions) {
        expect(row).toMatchObject({ ip_address: '', user_agent: '', device_id: 'deleted', device_name: 'deleted' });
        expect(row.refresh_token_hash).toMatch(/^[0-9a-f]{64}$/);
      }
      await request(server).post('/api/v1/auth/refresh').set('X-Forwarded-For', freshIp()).send({ refreshToken: s.refreshToken }).expect(401);
      await authed('get', '/auth/me', other.accessToken).expect(401);
      const [profile] = await select<{ display_name: string | null; bio: string | null; deleted_at: Date | null }>(
        'SELECT display_name, bio, deleted_at FROM profiles WHERE user_id = :u',
        { u: s.userId },
      );
      expect(profile).toEqual({ display_name: null, bio: null, deleted_at: expect.any(Date) });
      expect(await countOf('SELECT COUNT(*) AS n FROM profile_interests pi JOIN profiles p ON p.id = pi.profile_id WHERE p.user_id = :u', { u: s.userId })).toBe(0);
      expect(await countOf('SELECT COUNT(*) AS n FROM dating_preferences WHERE user_id = :u', { u: s.userId })).toBe(0);

      const [event] = await select<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM security_events WHERE event_type = 'account.deleted' AND user_id = :u`,
        { u: s.userId },
      );
      expect(event.metadata).toMatchObject({
        wasBanned: false,
        identifierHashPrefixes: [expect.stringMatching(/^[0-9a-f]{12}$/)],
        handlers: ['auth', 'interests', 'preferences', 'profile', 'data_exports', 'bans', 'auth.devices', 'users'],
        results: { auth: { revokedSessions: 2, scrubbedSessions: 2 }, interests: { interestsDeleted: 2 }, preferences: { preferencesDeleted: 1 } },
      });
      expect(JSON.stringify(event.metadata)).not.toContain(email);
      const [outbox] = await select<{ payload: unknown }>(`SELECT payload FROM outbox_events WHERE event_type = 'account.deleted' AND aggregate_id = :u`, { u: s.userId });
      expect(outbox.payload).toEqual({ userId: s.userId });
    });

    it('one failing handler rolls back the whole deletion (nothing changed)', async () => {
      const email = uniqueEmail('rollback');
      const s = await richUser(email);
      jest.spyOn(app.get(ProfileDeletionHandler), 'handle').mockRejectedValueOnce(new Error('profile store down'));

      await expect(app.get(AccountService).delete(s.userId, ctx)).rejects.toThrow('profile store down');

      expect(await userRow(s.userId)).toMatchObject({ email, status: 'active', deleted_at: null });
      expect(await countOf('SELECT COUNT(*) AS n FROM sessions WHERE user_id = :u AND revoked_at IS NULL', { u: s.userId })).toBe(1);
      // Handlers that ran before the failure were undone too.
      expect(await countOf('SELECT COUNT(*) AS n FROM profile_interests pi JOIN profiles p ON p.id = pi.profile_id WHERE p.user_id = :u', { u: s.userId })).toBe(2);
      expect(await countOf('SELECT COUNT(*) AS n FROM dating_preferences WHERE user_id = :u', { u: s.userId })).toBe(1);
      expect(await countOf(`SELECT COUNT(*) AS n FROM outbox_events WHERE event_type = 'account.deleted' AND aggregate_id = :u`, { u: s.userId })).toBe(0);
      expect(await redis.get(deletionMailKey(s.userId))).toBeNull();
      await authed('get', '/auth/me', s.accessToken).expect(200);
    });

    it('the same phone registers again afterwards and gets a new user id', async () => {
      const phone = indianMobile();
      const first = await login(app, phone);
      await app.get(AccountService).delete(first.userId, ctx);
      await clearCooldown(phone);
      const again = await login(app, phone, { ip: freshIp() });
      expect(again.userId).not.toBe(first.userId);
      expect(again.body.isNewUser).toBe(true);
    });

    it('the deletion email is sent once (no address in the outbox) and the Redis key is gone afterwards', async () => {
      const email = uniqueEmail('mail');
      const s = await login(app, email);
      await app.get(AccountService).delete(s.userId, ctx);
      // Sealed (AES-256-GCM): the address is never in Redis in plain text.
      const sealed = await redis.get(deletionMailKey(s.userId));
      expect(sealed).toEqual(expect.any(String));
      expect(sealed).not.toContain(email.split('@')[0]);

      expect(await deliver('account.deleted', s.userId)).toBe(1);
      // A redelivery (at-least-once) finds no key and sends nothing.
      await worker.get(HandlerRegistry).handlersFor('account.deleted')[0].handle({
        outboxId: 'x',
        type: 'account.deleted',
        aggregateId: s.userId,
        payload: { userId: s.userId },
        attempt: 2,
      });
      const mails = workerEmail.sent.filter((m) => m.to === email);
      expect(mails).toHaveLength(1);
      expect(mails[0].subject).toBe('Your Kuchu Puchu account has been deleted');
      expect(await redis.get(deletionMailKey(s.userId))).toBeNull();
    });

    it('a failed send puts the address back for the retry', async () => {
      const email = uniqueEmail('mailretry');
      const s = await login(app, email);
      await app.get(AccountService).delete(s.userId, ctx);
      workerEmail.failWith = new Error('SES down');
      try {
        await expect(deliver('account.deleted', s.userId)).rejects.toThrow('SES down');
      } finally {
        workerEmail.failWith = null;
      }
      expect(await redis.get(deletionMailKey(s.userId))).toEqual(expect.any(String));
      await deliver('account.deleted', s.userId, 2);
      expect(workerEmail.sent.filter((m) => m.to === email)).toHaveLength(1);
    });

    it('after the last failed attempt the sealed address is gone for good', async () => {
      const email = uniqueEmail('maillast');
      const s = await login(app, email);
      await app.get(AccountService).delete(s.userId, ctx);
      workerEmail.failWith = new Error('SES down');
      try {
        await expect(deliver('account.deleted', s.userId, 8)).rejects.toThrow('SES down');
      } finally {
        workerEmail.failWith = null;
      }
      expect(await redis.get(deletionMailKey(s.userId))).toBeNull();
    });

    it('no email on the account → nothing is sent', async () => {
      const phone = indianMobile();
      const s = await login(app, phone);
      const before = workerEmail.sent.length;
      await app.get(AccountService).delete(s.userId, ctx);
      await deliver('account.deleted', s.userId);
      expect(workerEmail.sent.length).toBe(before);
    });
  });

  describe('ban evasion', () => {
    async function banAndDelete(identifier: string, type: IdentifierType): Promise<{ userId: string; deviceId: string }> {
      const users = app.get(UsersService);
      const { user } = await users.createVerified(type, identifier);
      const device = newDevice();
      await openSession(app, user.id, device);
      await users.setStatus(user.id, UserStatus.Banned, 'test.ban');
      await app.get(AccountService).delete(user.id, ctx);
      return { userId: user.id, deviceId: device.deviceId };
    }

    const otpRequest = (identifier: string) =>
      request(server)
        .post('/api/v1/auth/otp/request')
        .set('X-Forwarded-For', freshIp())
        .send({ channel: identifier.includes('@') ? 'email' : 'sms', identifier });

    const verify = (identifier: string) =>
      request(server)
        .post('/api/v1/auth/otp/verify')
        .set('X-Forwarded-For', freshIp())
        .send({
          channel: identifier.includes('@') ? 'email' : 'sms',
          identifier,
          // Codes go to the normalised (lower-cased) address.
          otp: lastCode(app, identifier.includes('@') ? identifier.toLowerCase() : identifier),
          ...newDevice(),
        });

    it('a banned user deletes; signing up again with a +tag or dotted Gmail variant or the same phone is restricted', async () => {
      const local = `ban${randomUUID().slice(0, 8)}`;
      const banned = await banAndDelete(`${local}@gmail.com`, IdentifierType.Email);
      const phone = indianMobile();
      const bannedPhone = await banAndDelete(phone, IdentifierType.Phone);

      const hashes = await select<{ hash_type: string; source_user_id: string }>(
        'SELECT hash_type, source_user_id FROM ban_hashes WHERE source_user_id IN (:ids) ORDER BY hash_type',
        { ids: [banned.userId, bannedPhone.userId] },
      );
      expect(hashes.filter((h) => h.source_user_id === banned.userId).map((h) => h.hash_type)).toEqual(['identifier', 'device']);
      expect(hashes.filter((h) => h.source_user_id === bannedPhone.userId).map((h) => h.hash_type)).toEqual(['identifier', 'device']);
      expect(JSON.stringify(await select('SELECT * FROM ban_hashes WHERE source_user_id = :u', { u: banned.userId }))).not.toContain(local);
      // Deletion still frees the identifiers.
      expect(await userRow(banned.userId)).toMatchObject({ email: null, status: 'deactivated' });

      const unrelated = uniqueEmail('clean');
      const variants = [`${local}+again@gmail.com`, `${local.slice(0, 3)}.${local.slice(3)}@googlemail.com`, `${local.toUpperCase()}@Gmail.com`, phone];
      const unrelatedBody = (await otpRequest(unrelated).expect(200)).body;
      for (const identifier of variants) {
        // The aliases share one cooldown (fix(M06)); let it pass between them.
        await clearCooldown(identifier);
        // The request answers exactly like any other.
        expect((await otpRequest(identifier).expect(200)).body).toEqual(unrelatedBody);
        const res = await verify(identifier).expect(403);
        expect(res.body.code).toBe('ACCOUNT_RESTRICTED');
        expect(JSON.stringify(res.body)).not.toMatch(/accessToken|refreshToken/);
      }
      const leaked = await select<{ n: number }>(
        'SELECT COUNT(*) AS n FROM users WHERE email IN (:emails) OR phone = :phone',
        { emails: variants.slice(0, 3).map((v) => v.toLowerCase()), phone },
      );
      expect(Number(leaked[0].n)).toBe(0);
      const blocked = await select<{ n: number }>(
        `SELECT COUNT(*) AS n FROM security_events WHERE event_type = 'auth.login_blocked' AND JSON_EXTRACT(metadata, '$.reason') = 'ban_hash' AND created_at > NOW(3) - INTERVAL 1 MINUTE`,
      );
      expect(Number(blocked[0].n)).toBeGreaterThanOrEqual(4);
      // An unrelated address still signs up.
      await verify(unrelated).expect(200);
    });

    it('deleting a user who is not banned adds no ban hashes', async () => {
      const s = await login(app, uniqueEmail('notbanned'));
      await app.get(AccountService).delete(s.userId, ctx);
      expect(await countOf('SELECT COUNT(*) AS n FROM ban_hashes WHERE source_user_id = :u', { u: s.userId })).toBe(0);
    });
  });

  describe('data export', () => {
    const storage = () => app.get(StorageProvider) as LocalStorageProvider;

    it('builds a ZIP with the caller’s data only (two seeded users), emails without a link, and serves a fresh 15-minute URL', async () => {
      const emailA = uniqueEmail('expa');
      const emailB = uniqueEmail('expb');
      const a = await richUser(emailA);
      const b = await richUser(emailB);
      await stepUp(a, emailA);

      const started = await authed('post', '/account/export', a.accessToken).expect(202);
      expect(started.body.data).toEqual({ requestId: expect.any(String), status: 'pending' });
      const { requestId } = started.body.data as { requestId: string };
      expect((await authed('get', '/account/export', a.accessToken).expect(200)).body.data).toMatchObject({ requestId, status: 'pending', downloadUrl: null });

      expect(await deliver('data_export.requested', requestId)).toBe(1);

      const first = (await authed('get', '/account/export', a.accessToken).expect(200)).body.data;
      expect(first).toMatchObject({ requestId, status: 'ready', downloadUrl: expect.stringContaining(exportFileKey(requestId)) });
      const urlTtl = new Date(first.downloadUrlExpiresAt).getTime() - Date.now();
      expect(urlTtl).toBeGreaterThan(14 * 60_000);
      expect(urlTtl).toBeLessThanOrEqual(15 * 60_000);
      expect(new Date(first.expiresAt).getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
      const second = (await authed('get', '/account/export', a.accessToken).expect(200)).body.data;
      expect(second.downloadUrl).not.toBe(first.downloadUrl);
      // Every URL handed out is audited.
      expect(await countOf(`SELECT COUNT(*) AS n FROM security_events WHERE event_type = 'account.data_export_url_issued' AND user_id = :u`, { u: a.userId })).toBe(2);

      const zip = await storage().read('private', exportFileKey(requestId));
      expect(zip).not.toBeNull();
      const files = readZip(zip as Buffer);
      expect([...files.keys()].sort()).toEqual(
        ['account.json', 'interests.json', 'manifest.json', 'preferences.json', 'profile.json', 'security_events.json', 'sessions.json'].sort(),
      );
      const json = (name: string) => JSON.parse((files.get(name) as Buffer).toString()) as unknown;
      expect(json('account.json')).toMatchObject({ id: a.userId, email: emailA, status: 'active' });
      expect(json('profile.json')).toMatchObject({ displayName: 'Asha Rao', bio: 'Chai and long walks' });
      expect(json('interests.json')).toHaveLength(2);
      expect(json('preferences.json')).toMatchObject({ minAge: 25, maxAge: 35, maxDistanceKm: 50 });
      const sessions = json('sessions.json') as Array<Record<string, unknown>>;
      expect(Object.keys(sessions[0]).sort()).toEqual(['appVersion', 'deviceName', 'lastUsedAt', 'platform', 'signedInAt', 'signedOutAt', 'signedOutReason']);
      const events = json('security_events.json') as Array<Record<string, unknown>>;
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) expect(Object.keys(e).sort()).toEqual(['at', 'type']);
      // Only user-facing types: no OTP / fraud-guard / moderation internals.
      expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['auth.login_succeeded', 'account.data_export_requested']));
      expect(events.map((e) => e.type).filter((t) => String(t).startsWith('otp.') || t === 'user.status_changed')).toEqual([]);

      const everything = [...files.values()].map((f) => f.toString()).join('\n');
      expect(everything).not.toContain(b.userId);
      expect(everything).not.toContain(emailB);
      expect(everything).not.toMatch(/\b198\.(18|19)\.\d+\.\d+\b|203\.0\.113\.9/); // no IPs
      expect(everything).not.toContain(a.refreshToken.split('.')[1]);

      const mail = workerEmail.lastTo(emailA);
      expect(mail?.subject).toBe('Your Kuchu Puchu data export is ready');
      expect(mail?.text).not.toMatch(/https?:|local-storage:|exports\//);
      // B sees nothing of A's.
      expect((await authed('get', '/account/export', b.accessToken).expect(200)).body.data).toBeNull();
    });

    it('limits: no step-up → 403 REAUTH_REQUIRED; a second request within 24 h → 429 with retryAfterSeconds', async () => {
      const email = uniqueEmail('explimit');
      const s = await login(app, email);
      expect((await authed('post', '/account/export', s.accessToken).expect(403)).body.code).toBe('REAUTH_REQUIRED');
      await stepUp(s, email);
      await authed('post', '/account/export', s.accessToken).expect(202);
      const again = await authed('post', '/account/export', s.accessToken).expect(429);
      expect(again.body.code).toBe('TOO_MANY_REQUESTS');
      expect(again.body.details.retryAfterSeconds).toBeGreaterThan(86_000);
      expect(again.body.details.retryAfterSeconds).toBeLessThanOrEqual(86_400);
      await authed('get', '/account/export', '').expect(401);
    });

    it('a restricted user\'s export leaves moderation state out', async () => {
      const email = uniqueEmail('expmod');
      const s = await login(app, email);
      await app.get(UsersService).setStatus(s.userId, UserStatus.Suspended, 'test.suspend', { until: new Date(Date.now() + 86_400_000) });
      await app.get(UsersService).setStatus(s.userId, UserStatus.Active, 'test.lift');
      const contributor = worker.get(SecurityEventsExportContributor);
      const types = ((await contributor.collect(s.userId)) as Array<{ type: string }>).map((e) => e.type);
      expect(types).not.toContain('user.status_changed');
      expect(await countOf(`SELECT COUNT(*) AS n FROM security_events WHERE event_type = 'user.status_changed' AND user_id = :u`, { u: s.userId })).toBe(2);
    });

    it('failed builds do not use up the daily export, but at most 3 a day', async () => {
      const email = uniqueEmail('expfail');
      const s = await login(app, email);
      await stepUp(s, email);
      for (let i = 0; i < 3; i++) {
        const { requestId } = (await authed('post', '/account/export', s.accessToken).expect(202)).body.data as { requestId: string };
        await sequelize.query(`UPDATE data_export_requests SET status = 'failed' WHERE id = :id`, { replacements: { id: requestId } });
      }
      expect((await authed('post', '/account/export', s.accessToken).expect(429)).body.code).toBe('TOO_MANY_REQUESTS');
    });

    it('the last failed build attempt marks the request failed and leaves no file', async () => {
      const email = uniqueEmail('expbuildfail');
      const s = await login(app, email);
      await stepUp(s, email);
      const { requestId } = (await authed('post', '/account/export', s.accessToken).expect(202)).body.data as { requestId: string };
      jest.spyOn(worker.get(AccountExportRegistry), 'all').mockImplementationOnce(() => {
        throw new Error('contributor down');
      });
      await expect(deliver('data_export.requested', requestId, 8)).rejects.toThrow('contributor down');
      const [row] = await select<{ status: string }>('SELECT status FROM data_export_requests WHERE id = :id', { id: requestId });
      expect(row.status).toBe('failed');
      expect(await storage().read('private', exportFileKey(requestId))).toBeNull();
      expect((await authed('get', '/account/export', s.accessToken).expect(200)).body.data).toMatchObject({ status: 'failed', downloadUrl: null });
    });

    it('an expired link → no URL; the hourly job marks it expired and deletes the file', async () => {
      const email = uniqueEmail('expexp');
      const s = await login(app, email);
      await stepUp(s, email);
      const { requestId } = (await authed('post', '/account/export', s.accessToken).expect(202)).body.data as { requestId: string };
      await deliver('data_export.requested', requestId);
      await sequelize.query('UPDATE data_export_requests SET expires_at = NOW(3) - INTERVAL 1 SECOND WHERE id = :id', { replacements: { id: requestId } });

      expect((await authed('get', '/account/export', s.accessToken).expect(200)).body.data).toMatchObject({ status: 'expired', downloadUrl: null });

      expect(await worker.get(DataExportExpiryJob).expire()).toBeGreaterThanOrEqual(1);
      const [row] = await select<{ status: string }>('SELECT status FROM data_export_requests WHERE id = :id', { id: requestId });
      expect(row.status).toBe('expired');
      expect(await storage().read('private', exportFileKey(requestId))).toBeNull();
    });

    it('deleting the account deletes the export rows and purges their files after the commit', async () => {
      const email = uniqueEmail('exppurge');
      const s = await login(app, email);
      await stepUp(s, email);
      const { requestId } = (await authed('post', '/account/export', s.accessToken).expect(202)).body.data as { requestId: string };
      await deliver('data_export.requested', requestId);
      expect(await storage().read('private', exportFileKey(requestId))).not.toBeNull();

      await app.get(AccountService).delete(s.userId, ctx);
      expect(await countOf('SELECT COUNT(*) AS n FROM data_export_requests WHERE user_id = :u', { u: s.userId })).toBe(0);
      // The file is still there until the purge event is handled.
      expect(await storage().read('private', exportFileKey(requestId))).not.toBeNull();
      expect(await deliver('data_export.purge', s.userId)).toBe(1);
      expect(await storage().read('private', exportFileKey(requestId))).toBeNull();
    });
  });

  it('migration: email and phone are nulled on rows soft-deleted before M07; the count is printed', async () => {
    const id = randomUUID();
    const phone = indianMobile();
    await sequelize.query(
      `INSERT INTO users (id, phone, phone_verified_at, status, role, created_at, updated_at, deleted_at) VALUES (:id, :phone, NOW(3), 'deactivated', 'user', NOW(3), NOW(3), NOW(3))`,
      { replacements: { id, phone } },
    );
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await nullDeletedIdentifiers({ context: sequelize.getQueryInterface(), name: 'test', path: undefined });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[M07\] users: nulled email and phone on [1-9]\d* soft-deleted rows$/));
    expect(await userRow(id)).toMatchObject({ email: null, phone: null });
    await nullDeletedIdentifiers({ context: sequelize.getQueryInterface(), name: 'test', path: undefined });
    expect(log).toHaveBeenLastCalledWith('[M07] users: nulled email and phone on 0 soft-deleted rows');
    // The phone can sign up again.
    await login(app, phone);
    void clearCooldown;
  });
});
