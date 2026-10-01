import { randomUUID } from 'node:crypto';

import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { getConnectionToken } from '@nestjs/sequelize';
import type { Redis } from 'ioredis';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import request from 'supertest';

import { OtpCleanupJob, SessionCleanupJob } from '../../src/auth/auth-cleanup.jobs';
import { IdentifierType } from '../../src/auth/models/otp-verification.model';
import { istDay, smsBudgetKey } from '../../src/auth/services/otp-delivery.service';
import { otpCooldownKey, OtpService } from '../../src/auth/services/otp.service';
import { AlertProvider } from '../../src/infra/alerts/alert.provider';
import { REDIS_CLIENT } from '../../src/infra/redis/redis.module';
import { UserStatus } from '../../src/users/models/user.model';
import { UsersService } from '../../src/users/users.service';
import { freshIp, indianMobile, lastCode, login, newDevice, openSession, uniqueEmail, usMobile } from '../support/auth-helpers';
import { capture, scanLines } from '../support/log-capture';
import { createTestApp, fakeEmail, fakeSms } from '../support/test-app';

describe('M06 Auth (MySQL 8.4 + Redis)', () => {
  let app: NestExpressApplication;
  let sequelize: Sequelize;
  let redis: Redis;
  let server: ReturnType<NestExpressApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    sequelize = app.get<Sequelize>(getConnectionToken());
    redis = app.get<Redis>(REDIS_CLIENT);
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(() => jest.restoreAllMocks());

  const select = <T extends object>(sql: string, replacements: Record<string, unknown> = {}): Promise<T[]> =>
    sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT });

  const channelOf = (identifier: string): 'email' | 'sms' => (identifier.includes('@') ? 'email' : 'sms');

  const otpRequest = (identifier: string, ip = freshIp()): request.Test =>
    request(server).post('/api/v1/auth/otp/request').set('X-Forwarded-For', ip).send({ channel: channelOf(identifier), identifier });

  const otpVerify = (identifier: string, otp: string, ip = freshIp(), device = newDevice()): request.Test =>
    request(server)
      .post('/api/v1/auth/otp/verify')
      .set('X-Forwarded-For', ip)
      .send({ channel: channelOf(identifier), identifier, otp, ...device });

  const refresh = (refreshToken: string): request.Test =>
    request(server).post('/api/v1/auth/refresh').set('X-Forwarded-For', freshIp()).send({ refreshToken });

  const authed = (method: 'get' | 'post' | 'delete', path: string, token: string): request.Test =>
    request(server)[method](`/api/v1${path}`).set('X-Forwarded-For', freshIp()).set('Authorization', `Bearer ${token}`);

  /** Lets another code be requested for the identifier now (the 60 s cooldown passing). */
  async function clearCooldown(identifier: string): Promise<void> {
    const type = identifier.includes('@') ? IdentifierType.Email : IdentifierType.Phone;
    await redis.del(otpCooldownKey(app.get(OtpService).hashIdentifier(type, identifier)));
  }

  const sessionRows = (userId: string) =>
    select<{ id: string; device_id: string; revoked_at: Date | null; revoked_reason: string | null }>(
      'SELECT id, device_id, revoked_at, revoked_reason FROM sessions WHERE user_id = :userId ORDER BY created_at',
      { userId },
    );

  const outboxEvents = (type: string, userId: string) =>
    select<{ payload: Record<string, string> }>('SELECT payload FROM outbox_events WHERE event_type = :type AND aggregate_id = :userId', {
      type,
      userId,
    });

  const securityEvents = (type: string, userId: string) =>
    select<{ metadata: Record<string, unknown> }>('SELECT metadata FROM security_events WHERE event_type = :type AND user_id = :userId', {
      type,
      userId,
    });

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
      (
        await select<{ cols: string }>(
          `SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND INDEX_NAME <> 'PRIMARY' GROUP BY INDEX_NAME`,
          { table },
        )
      )
        .map((r) => r.cols)
        .sort();

    it('otp_verifications is exactly the spec (no updated_at, both indexes)', async () => {
      expect(await columns('otp_verifications')).toEqual({
        id: 'char(36)',
        identifier_hash: 'char(64)',
        channel: "enum('sms','email')",
        purpose: "enum('login','reauth')",
        otp_hash: 'char(64)',
        attempts: 'tinyint unsigned',
        expires_at: 'datetime(3)',
        consumed_at: 'datetime(3) NULL',
        request_ip: 'varchar(45)',
        created_at: 'datetime(3)',
      });
      expect(await indexes('otp_verifications')).toEqual(['identifier_hash,created_at', 'request_ip,created_at']);
    });

    it('sessions is exactly the spec (+ standard columns, both indexes)', async () => {
      expect(await columns('sessions')).toEqual({
        id: 'char(36)',
        user_id: 'char(36)',
        refresh_token_hash: 'char(64)',
        previous_token_hash: 'char(64) NULL',
        device_id: 'varchar(100)',
        device_name: 'varchar(100)',
        platform: "enum('android','ios')",
        app_version: 'varchar(20)',
        ip_address: 'varchar(45)',
        user_agent: 'varchar(255)',
        last_used_at: 'datetime(3)',
        expires_at: 'datetime(3)',
        absolute_expires_at: 'datetime(3)',
        reauthenticated_at: 'datetime(3) NULL',
        revoked_at: 'datetime(3) NULL',
        revoked_reason: 'varchar(40) NULL',
        created_at: 'datetime(3)',
        updated_at: 'datetime(3)',
      });
      expect(await indexes('sessions')).toEqual(['user_id,device_id', 'user_id,revoked_at']);
    });
  });

  describe('sign-in', () => {
    it('verify creates the user and returns {accessToken, refreshToken, expiresIn, user, isNewUser, nextStep}', async () => {
      const email = uniqueEmail('new');
      const first = await login(app, email);
      expect(Object.keys(first.body).sort()).toEqual(['accessToken', 'expiresIn', 'isNewUser', 'nextStep', 'refreshToken', 'user']);
      expect(first.body).toMatchObject({ expiresIn: 900, isNewUser: true, nextStep: 'selfie' });
      expect(first.refreshToken).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{64}$/);
      expect(await outboxEvents('user.registered', first.userId)).toEqual([{ payload: { userId: first.userId } }]);
      // Claims {sub, sid, iss, aud} only: no role in the token.
      const claims = new JwtService().decode<Record<string, unknown>>(first.accessToken);
      expect(Object.keys(claims).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sid', 'sub']);
      expect(claims.exp as number).toBe((claims.iat as number) + 900);

      await clearCooldown(email);
      const again = await login(app, email);
      expect(again.body).toMatchObject({ isNewUser: false, nextStep: 'selfie' });
      expect(again.userId).toBe(first.userId);

      const me = await authed('get', '/auth/me', again.accessToken).expect(200);
      expect(me.body.data).toMatchObject({ id: first.userId, email, nextStep: 'selfie', profile: null });
    });

    it('race: two parallel verifies of one code → exactly one success', async () => {
      const phone = indianMobile();
      await otpRequest(phone).expect(200);
      const code = lastCode(app, phone);
      const results = await Promise.all([otpVerify(phone, code), otpVerify(phone, code)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
      expect(results.find((r) => r.status === 401)?.body.code).toBe('OTP_INVALID');
      const [{ n }] = await select<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE phone = :phone', { phone });
      expect(Number(n)).toBe(1);
    });

    it('6th attempt fails even with the right code; every failure is the same 401 OTP_INVALID', async () => {
      const email = uniqueEmail('attempts');
      await otpRequest(email).expect(200);
      const code = lastCode(app, email);
      const wrong = code === '000000' ? '111111' : '000000';
      const bodies: unknown[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await otpVerify(email, wrong).expect(401);
        bodies.push({ code: res.body.code, message: res.body.message });
      }
      const sixth = await otpVerify(email, code).expect(401);
      bodies.push({ code: sixth.body.code, message: sixth.body.message });
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
      expect(bodies[0]).toEqual({ code: 'OTP_INVALID', message: 'Invalid or expired verification code' });
      const [row] = await select<{ attempts: number }>(
        'SELECT attempts FROM otp_verifications WHERE identifier_hash = :h ORDER BY created_at DESC LIMIT 1',
        { h: app.get(OtpService).hashIdentifier(IdentifierType.Email, email) },
      );
      expect(Number(row.attempts)).toBe(5);
    });

    it('an expired code fails; a used code fails; a new code expires the older one', async () => {
      const email = uniqueEmail('expiry');
      const hash = app.get(OtpService).hashIdentifier(IdentifierType.Email, email);
      await otpRequest(email).expect(200);
      const first = lastCode(app, email);
      await clearCooldown(email);
      await otpRequest(email).expect(200);
      const second = lastCode(app, email);
      // Only one active code per identifier.
      const [{ active }] = await select<{ active: number }>(
        'SELECT COUNT(*) AS active FROM otp_verifications WHERE identifier_hash = :hash AND consumed_at IS NULL AND expires_at > NOW(3)',
        { hash },
      );
      expect(Number(active)).toBe(1);
      if (first !== second) await otpVerify(email, first).expect(401);

      await sequelize.query('UPDATE otp_verifications SET expires_at = NOW(3) - INTERVAL 1 SECOND WHERE identifier_hash = :hash', {
        replacements: { hash },
      });
      await otpVerify(email, second).expect(401);

      await clearCooldown(email);
      await otpRequest(email).expect(200);
      const third = lastCode(app, email);
      await otpVerify(email, third).expect(200);
      await otpVerify(email, third).expect(401);
    });

    it('no plaintext OTP or token is stored', async () => {
      const email = uniqueEmail('plain');
      const s = await login(app, email);
      const code = (await select<{ otp_hash: string }>('SELECT otp_hash FROM otp_verifications ORDER BY created_at DESC LIMIT 1'))[0];
      const dump = JSON.stringify([
        await select('SELECT * FROM otp_verifications'),
        await select('SELECT * FROM sessions WHERE user_id = :u', { u: s.userId }),
      ]);
      expect(code.otp_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(dump).not.toContain(s.refreshToken.split('.')[1]);
      expect(dump).not.toContain(s.accessToken);
      expect(dump).not.toContain(email);
    });
  });

  describe('no enumeration', () => {
    it('identical /otp/request responses for unknown, known, banned and deleted identifiers (status and body), first and second request', async () => {
      const users = app.get(UsersService);
      const unknown = indianMobile();
      const known = indianMobile();
      const banned = indianMobile();
      const deleted = indianMobile();
      await users.createVerified(IdentifierType.Phone, known);
      const { user: bannedUser } = await users.createVerified(IdentifierType.Phone, banned);
      await users.setStatus(bannedUser.id, UserStatus.Banned, 'test.ban');
      // A legacy deleted row that still holds its phone (M07 will null these).
      await sequelize.query(
        `INSERT INTO users (id, phone, status, role, created_at, updated_at, deleted_at) VALUES (:id, :phone, 'deactivated', 'user', NOW(3), NOW(3), NOW(3))`,
        { replacements: { id: randomUUID(), phone: deleted } },
      );

      const first = [];
      const second = [];
      for (const phone of [unknown, known, banned, deleted]) first.push(await otpRequest(phone));
      for (const phone of [unknown, known, banned, deleted]) second.push(await otpRequest(phone));
      const shape = (r: request.Response) => JSON.stringify({ status: r.status, body: r.body });
      expect(new Set(first.map(shape)).size).toBe(1);
      expect(first[0].status).toBe(200);
      expect(first[0].body).toEqual({
        success: true,
        data: { message: 'If the details are valid, a verification code has been sent.', expiresInSeconds: 300, resendAfterSeconds: 60 },
      });
      // The cooldown applies the same way to every identifier (retryAfterSeconds may differ by a second).
      expect(second.map((r) => [r.status, r.body.code])).toEqual(Array(4).fill([429, 'OTP_COOLDOWN']));
      // Every one of them was sent a code.
      for (const phone of [unknown, known, banned, deleted]) expect(fakeSms(app).lastCodeFor(phone)).toMatch(/^\d{6}$/);
    });

    it('banned or suspended user with the CORRECT code → 403 ACCOUNT_RESTRICTED, no tokens, no session', async () => {
      const users = app.get(UsersService);
      for (const status of [UserStatus.Banned, UserStatus.Suspended]) {
        const phone = indianMobile();
        const { user } = await users.createVerified(IdentifierType.Phone, phone);
        await users.setStatus(user.id, status, 'test.policy', status === UserStatus.Suspended ? { until: new Date(Date.now() + 86_400_000) } : {});
        await otpRequest(phone).expect(200);
        const res = await otpVerify(phone, lastCode(app, phone)).expect(403);
        expect(res.body.code).toBe('ACCOUNT_RESTRICTED');
        expect(JSON.stringify(res.body)).not.toMatch(/accessToken|refreshToken/);
        expect(await sessionRows(user.id)).toEqual([]);
      }
    });
  });

  describe('limits', () => {
    it('cooldown → 429 OTP_COOLDOWN with retryAfterSeconds', async () => {
      const email = uniqueEmail('cooldown');
      await otpRequest(email).expect(200);
      const res = await otpRequest(email).expect(429);
      expect(res.body.code).toBe('OTP_COOLDOWN');
      expect(res.body.details.retryAfterSeconds).toBeGreaterThan(55);
      expect(res.body.details.retryAfterSeconds).toBeLessThanOrEqual(60);
    });

    it('hourly per-identifier cap: the 6th code within an hour → 429 TOO_MANY_REQUESTS with retryAfterSeconds', async () => {
      const email = uniqueEmail('hourly');
      for (let i = 0; i < 5; i++) {
        await clearCooldown(email);
        await otpRequest(email).expect(200);
      }
      await clearCooldown(email);
      const res = await otpRequest(email).expect(429);
      expect(res.body.code).toBe('TOO_MANY_REQUESTS');
      expect(res.body.details.retryAfterSeconds).toBeGreaterThan(3500);
      expect(res.body.details.retryAfterSeconds).toBeLessThanOrEqual(3600);
    });

    it('per-IP cap: 20 codes in the last hour from one IP → 429 TOO_MANY_REQUESTS with retryAfterSeconds', async () => {
      const ip = freshIp();
      // 20 codes from this IP in the last hour (the HTTP throttle allows only 5 per minute, so they are seeded).
      for (let i = 0; i < 20; i++) {
        await sequelize.query(
          `INSERT INTO otp_verifications (id, identifier_hash, channel, purpose, otp_hash, expires_at, request_ip, created_at)
           VALUES (:id, :h, 'email', 'login', :h, NOW(3), :ip, NOW(3) - INTERVAL 30 MINUTE)`,
          { replacements: { id: randomUUID(), h: randomUUID().replace(/-/g, '').padEnd(64, '0'), ip } },
        );
      }
      const res = await otpRequest(uniqueEmail('ip'), ip).expect(429);
      expect(res.body.code).toBe('TOO_MANY_REQUESTS');
      expect(res.body.details.retryAfterSeconds).toBeGreaterThan(1700);
      expect(res.body.details.retryAfterSeconds).toBeLessThanOrEqual(1800);
    });

    it('HTTP throttles: request 5/min per IP, verify 10/min per IP', async () => {
      const ip = freshIp();
      for (let i = 0; i < 5; i++) await request(server).post('/api/v1/auth/otp/request').set('X-Forwarded-For', ip).send({}).expect(400);
      const blocked = await request(server).post('/api/v1/auth/otp/request').set('X-Forwarded-For', ip).send({}).expect(429);
      expect(blocked.body.details.retryAfterSeconds).toBeGreaterThan(0);
      const ip2 = freshIp();
      for (let i = 0; i < 10; i++) await request(server).post('/api/v1/auth/otp/verify').set('X-Forwarded-For', ip2).send({}).expect(400);
      await request(server).post('/api/v1/auth/otp/verify').set('X-Forwarded-For', ip2).send({}).expect(429);
    });
  });

  describe('SMS fraud guard', () => {
    it('a number outside OTP_SMS_ALLOWED_COUNTRIES: the same 200, no SMS, a security event', async () => {
      const us = usMobile();
      const sent = fakeSms(app).sent.length;
      const res = await otpRequest(us).expect(200);
      expect(res.body.data.message).toBe('If the details are valid, a verification code has been sent.');
      expect(fakeSms(app).sent.length).toBe(sent);
      const [{ n }] = await select<{ n: number }>(
        `SELECT COUNT(*) AS n FROM security_events WHERE event_type = 'otp.sms_country_blocked' AND created_at > NOW(3) - INTERVAL 1 MINUTE`,
      );
      expect(Number(n)).toBeGreaterThanOrEqual(1);
    });

    it('daily SMS budget (Redis, per IST date): alert at 80 %; at 100 % the same 200, no SMS, alert and security event', async () => {
      const key = smsBudgetKey(istDay());
      const budget = 10_000;
      const alerts = jest.spyOn(app.get(AlertProvider), 'send');
      try {
        await redis.set(key, String(Math.ceil(budget * 0.8) - 1));
        await otpRequest(indianMobile()).expect(200);
        expect(alerts).toHaveBeenCalledWith(expect.objectContaining({ kind: 'sms_budget_warning', used: 8000, budget }));

        await redis.set(key, String(budget));
        const phone = indianMobile();
        const res = await otpRequest(phone).expect(200);
        expect(res.body.data.message).toBe('If the details are valid, a verification code has been sent.');
        expect(fakeSms(app).lastCodeFor(phone)).toBeUndefined();
        expect(alerts).toHaveBeenCalledWith(expect.objectContaining({ kind: 'sms_budget_exhausted', budget }));
        const [{ n }] = await select<{ n: number }>(
          `SELECT COUNT(*) AS n FROM security_events WHERE event_type = 'otp.sms_budget_blocked' AND created_at > NOW(3) - INTERVAL 1 MINUTE`,
        );
        expect(Number(n)).toBeGreaterThanOrEqual(1);
        // Email is not part of the SMS budget.
        const email = uniqueEmail('budget');
        await otpRequest(email).expect(200);
        expect(fakeEmail(app).lastTo(email)).toBeDefined();
      } finally {
        await redis.del(key);
      }
    });
  });

  describe('refresh tokens', () => {
    it('race: two parallel refreshes of one token → one success; the other is reuse and revokes ALL sessions', async () => {
      const email = uniqueEmail('race');
      const a = await login(app, email);
      const b = await openSession(app, a.userId);
      const [r1, r2] = await Promise.all([refresh(a.refreshToken), refresh(a.refreshToken)]);
      expect([r1.status, r2.status].sort()).toEqual([200, 401]);
      const winner = r1.status === 200 ? r1 : r2;
      expect((r1.status === 401 ? r1 : r2).body.code).toBe('UNAUTHORIZED');
      const rows = await sessionRows(a.userId);
      expect(rows.every((r) => r.revoked_at !== null && r.revoked_reason === 'reuse_detected')).toBe(true);
      // Even the winner's new pair and the other device are signed out.
      await refresh(winner.body.data.refreshToken).expect(401);
      await authed('get', '/auth/me', b.accessToken).expect(401);
      expect(await outboxEvents('auth.token_reuse', a.userId)).toHaveLength(1);
    });

    it('reuse of an old token → every session revoked, auth.token_reuse published, security event, 401 UNAUTHORIZED', async () => {
      const a = await login(app, uniqueEmail('reuse'));
      const other = await openSession(app, a.userId);
      const rotated = await refresh(a.refreshToken).expect(200);
      expect(Object.keys(rotated.body.data).sort()).toEqual(['accessToken', 'expiresIn', 'refreshToken']);

      const replay = await refresh(a.refreshToken).expect(401);
      expect(replay.body.code).toBe('UNAUTHORIZED');
      expect((await sessionRows(a.userId)).map((r) => r.revoked_reason)).toEqual(['reuse_detected', 'reuse_detected']);
      expect(await outboxEvents('auth.token_reuse', a.userId)).toEqual([{ payload: { userId: a.userId, sessionId: a.sessionId } }]);
      expect(await securityEvents('auth.refresh_token_reuse_detected', a.userId)).toHaveLength(1);
      await refresh(rotated.body.data.refreshToken).expect(401);
      await authed('get', '/auth/me', other.accessToken).expect(401);
    });

    it('sliding expiry extends to now + 30 d on refresh; absolute expiry never moves and caps it', async () => {
      const a = await login(app, uniqueEmail('sliding'));
      const times = () =>
        select<{ sliding_days: number; absolute_days: number; absolute: Date }>(
          `SELECT TIMESTAMPDIFF(SECOND, NOW(3), expires_at) / 86400 AS sliding_days,
                  TIMESTAMPDIFF(SECOND, created_at, absolute_expires_at) / 86400 AS absolute_days, absolute_expires_at AS absolute
             FROM sessions WHERE id = :id`,
          { id: a.sessionId },
        ).then((r) => r[0]);
      const created = await times();
      expect(Math.round(Number(created.sliding_days))).toBe(30);
      expect(Math.round(Number(created.absolute_days))).toBe(90);

      await sequelize.query('UPDATE sessions SET expires_at = NOW(3) + INTERVAL 1 DAY WHERE id = :id', { replacements: { id: a.sessionId } });
      const r1 = await refresh(a.refreshToken).expect(200);
      const slid = await times();
      expect(Math.round(Number(slid.sliding_days))).toBe(30);
      expect(new Date(slid.absolute).getTime()).toBe(new Date(created.absolute).getTime());

      // Near the absolute end, the slide is capped at absolute_expires_at, which never moves.
      await sequelize.query('UPDATE sessions SET absolute_expires_at = NOW(3) + INTERVAL 5 DAY WHERE id = :id', {
        replacements: { id: a.sessionId },
      });
      const [{ absolute: capAt }] = await select<{ absolute: Date }>('SELECT absolute_expires_at AS absolute FROM sessions WHERE id = :id', {
        id: a.sessionId,
      });
      const r2 = await refresh(r1.body.data.refreshToken).expect(200);
      const [capped] = await select<{ expires_at: Date; absolute_expires_at: Date }>(
        'SELECT expires_at, absolute_expires_at FROM sessions WHERE id = :id',
        { id: a.sessionId },
      );
      expect(new Date(capped.expires_at).getTime()).toBe(new Date(capAt).getTime());
      expect(new Date(capped.absolute_expires_at).getTime()).toBe(new Date(capAt).getTime());

      // Past the absolute end, refresh fails and the access token stops working.
      await sequelize.query('UPDATE sessions SET absolute_expires_at = NOW(3) - INTERVAL 1 SECOND WHERE id = :id', {
        replacements: { id: a.sessionId },
      });
      await refresh(r2.body.data.refreshToken).expect(401);
      await authed('get', '/auth/me', r2.body.data.accessToken).expect(401);
    });
  });

  describe('devices', () => {
    it('same deviceId login replaces that session; a new device publishes auth.new_device, a known one does not', async () => {
      const email = uniqueEmail('device');
      const phoneDevice = newDevice({ deviceName: 'Phone' });
      const first = await login(app, email, { device: phoneDevice });
      // Registration login: no "new device" warning for a brand-new account.
      expect(await outboxEvents('auth.new_device', first.userId)).toEqual([]);

      await clearCooldown(email);
      const second = await login(app, email, { device: phoneDevice });
      const rows = await sessionRows(first.userId);
      expect(rows.map((r) => [r.id, r.revoked_reason])).toEqual([
        [first.sessionId, 'replaced'],
        [second.sessionId, null],
      ]);
      await authed('get', '/auth/me', first.accessToken).expect(401);
      await refresh(first.refreshToken).expect(401);
      expect(await outboxEvents('auth.new_device', first.userId)).toEqual([]);

      await clearCooldown(email);
      const tablet = await login(app, email, { device: newDevice({ deviceName: 'Tablet', platform: 'ios' }) });
      expect(await outboxEvents('auth.new_device', first.userId)).toEqual([{ payload: { userId: first.userId, sessionId: tablet.sessionId } }]);
      expect(await securityEvents('auth.new_device', first.userId)).toHaveLength(1);
    });

    it('GET /auth/sessions: name, platform, app version, last used, current; other sessions have a masked IP', async () => {
      const email = uniqueEmail('list');
      const myIp = `203.0.113.${Math.floor(Math.random() * 254) + 1}`;
      const otherIp = `198.51.100.${Math.floor(Math.random() * 254) + 1}`;
      const me = await login(app, email, { ip: myIp, device: newDevice({ deviceName: 'Mine', platform: 'ios', appVersion: '2.1.0' }) });
      await clearCooldown(email);
      await login(app, email, { ip: otherIp, device: newDevice({ deviceName: 'Other' }) });
      const res = await request(server)
        .get('/api/v1/auth/sessions')
        .set('X-Forwarded-For', myIp)
        .set('Authorization', `Bearer ${me.accessToken}`)
        .expect(200);
      const list = res.body.data as Array<Record<string, unknown>>;
      expect(list).toHaveLength(2);
      const mine = list.find((s) => s.current);
      const other = list.find((s) => !s.current);
      expect(mine).toMatchObject({ id: me.sessionId, deviceName: 'Mine', platform: 'ios', appVersion: '2.1.0', ipAddress: myIp });
      expect(other).toMatchObject({ deviceName: 'Other', platform: 'android', ipAddress: '198.51.100.*', current: false });
      expect(Object.keys(mine as object).sort()).toEqual(
        ['appVersion', 'createdAt', 'current', 'deviceName', 'id', 'ipAddress', 'lastUsedAt', 'platform'].sort(),
      );
    });

    it("DELETE /auth/sessions/:id: own session → 200 and it stops working; someone else's or unknown → 404", async () => {
      const a = await login(app, uniqueEmail('del-a'));
      const a2 = await openSession(app, a.userId);
      const b = await login(app, uniqueEmail('del-b'));

      const notMine = await authed('delete', `/auth/sessions/${b.sessionId}`, a.accessToken).expect(404);
      expect(notMine.body.code).toBe('NOT_FOUND');
      await authed('delete', `/auth/sessions/${randomUUID()}`, a.accessToken).expect(404);
      await authed('delete', '/auth/sessions/not-a-uuid', a.accessToken).expect(404);
      await authed('get', '/auth/me', b.accessToken).expect(200);

      await authed('delete', `/auth/sessions/${a2.sessionId}`, a.accessToken).expect(200);
      await authed('get', '/auth/me', a2.accessToken).expect(401);
      await authed('delete', `/auth/sessions/${a2.sessionId}`, a.accessToken).expect(404);
      await authed('get', '/auth/me', a.accessToken).expect(200);
    });

    it('logout is always 200 (even for an unknown token); logout-all revokes every session including the current one', async () => {
      const a = await login(app, uniqueEmail('logout'));
      const a2 = await openSession(app, a.userId);
      for (const token of [`${randomUUID()}.${'x'.repeat(64)}`, 'y'.repeat(40)]) {
        await request(server).post('/api/v1/auth/logout').send({ refreshToken: token }).expect(200);
      }
      await request(server).post('/api/v1/auth/logout').send({ refreshToken: a2.refreshToken }).expect(200);
      await authed('get', '/auth/me', a2.accessToken).expect(401);
      await request(server).post('/api/v1/auth/logout').send({ refreshToken: a2.refreshToken }).expect(200);

      const a3 = await openSession(app, a.userId);
      await authed('post', '/auth/logout-all', a.accessToken).expect(200);
      await authed('get', '/auth/me', a.accessToken).expect(401);
      await authed('get', '/auth/me', a3.accessToken).expect(401);
      expect((await sessionRows(a.userId)).filter((r) => r.revoked_at === null)).toEqual([]);
    });
  });

  describe('step-up', () => {
    it('DELETE /account without a fresh step-up → 403 REAUTH_REQUIRED; after reauth/verify → 200', async () => {
      const phone = indianMobile();
      const a = await login(app, phone);
      const denied = await authed('delete', '/account', a.accessToken).expect(403);
      expect(denied.body.code).toBe('REAUTH_REQUIRED');

      // The login code cannot be used for step-up, and a wrong code is the generic 401.
      await clearCooldown(phone);
      const sent = await authed('post', '/auth/reauth/request', a.accessToken).send({}).expect(200);
      expect(sent.body.data).toMatchObject({ channel: 'sms', expiresInSeconds: 300, resendAfterSeconds: 60 });
      const code = lastCode(app, phone);
      const bad = await authed('post', '/auth/reauth/verify', a.accessToken).send({ otp: code === '000000' ? '111111' : '000000' }).expect(401);
      expect(bad.body.code).toBe('OTP_INVALID');
      await authed('delete', '/account', a.accessToken).expect(403);

      const ok = await authed('post', '/auth/reauth/verify', a.accessToken).send({ otp: code }).expect(200);
      expect(ok.body.data.validForSeconds).toBe(600);
      // A step-up on one session does not unlock another.
      const other = await openSession(app, a.userId);
      await authed('delete', '/account', other.accessToken).expect(403);

      await authed('delete', '/account', a.accessToken).expect(200);
      expect(await securityEvents('auth.reauth_succeeded', a.userId)).toHaveLength(1);
      expect(await securityEvents('auth.reauth_failed', a.userId)).toHaveLength(1);
      expect((await sessionRows(a.userId)).every((r) => r.revoked_reason === 'deleted')).toBe(true);
    });

    it('a step-up older than 10 minutes no longer counts; a login code cannot be used for step-up', async () => {
      const email = uniqueEmail('stale');
      const a = await login(app, email);
      await sequelize.query('UPDATE sessions SET reauthenticated_at = NOW(3) - INTERVAL 11 MINUTE WHERE id = :id', {
        replacements: { id: a.sessionId },
      });
      await authed('delete', '/account', a.accessToken).expect(403);

      await clearCooldown(email);
      await otpRequest(email).expect(200); // purpose=login
      await authed('post', '/auth/reauth/verify', a.accessToken).send({ otp: lastCode(app, email) }).expect(401);

      await clearCooldown(email);
      await authed('post', '/auth/reauth/request', a.accessToken).send({ channel: 'sms' }).expect(400);
    });
  });

  describe('cleanup jobs', () => {
    it('OTP cleanup deletes only codes older than 24 h (in batches)', async () => {
      const marker = randomUUID().replace(/-/g, '').padEnd(64, 'a');
      const seed = async (hoursAgo: number): Promise<void> => {
        await sequelize.query(
          `INSERT INTO otp_verifications (id, identifier_hash, channel, purpose, otp_hash, expires_at, request_ip, created_at)
           VALUES (:id, :marker, 'sms', 'login', :marker, NOW(3), '192.0.2.200', NOW(3) - INTERVAL :hoursAgo HOUR)`,
          { replacements: { id: randomUUID(), marker, hoursAgo } },
        );
      };
      for (const h of [25, 30, 48, 24.5, 23, 1, 0]) await seed(h);
      const deleted = await new OtpCleanupJob(sequelize).deleteExpired(2);
      expect(deleted).toBeGreaterThanOrEqual(4);
      const left = await select<{ h: number }>(
        'SELECT ROUND(TIMESTAMPDIFF(MINUTE, created_at, NOW(3)) / 60) AS h FROM otp_verifications WHERE identifier_hash = :marker ORDER BY h',
        { marker },
      );
      expect(left.map((r) => Number(r.h))).toEqual([0, 1, 23]);
    });

    it('session cleanup deletes only expired sessions and sessions revoked more than 30 days ago', async () => {
      const a = await login(app, uniqueEmail('cleanup'));
      const make = async (label: string, set: string): Promise<string> => {
        const s = await openSession(app, a.userId, newDevice({ deviceName: label }));
        await sequelize.query(`UPDATE sessions SET ${set} WHERE id = :id`, { replacements: { id: s.sessionId } });
        return label;
      };
      await make('sliding-expired', 'expires_at = NOW(3) - INTERVAL 1 MINUTE');
      await make('absolute-expired', 'absolute_expires_at = NOW(3) - INTERVAL 1 MINUTE');
      await make('revoked-31d', "revoked_at = NOW(3) - INTERVAL 31 DAY, revoked_reason = 'logout'");
      await make('revoked-29d', "revoked_at = NOW(3) - INTERVAL 29 DAY, revoked_reason = 'logout'");
      await make('live', 'last_used_at = NOW(3)');
      await new SessionCleanupJob(sequelize).deleteExpired(2);
      const left = await select<{ device_name: string }>('SELECT device_name FROM sessions WHERE user_id = :u ORDER BY device_name', {
        u: a.userId,
      });
      expect(left.map((r) => r.device_name)).toEqual(['live', 'revoked-29d', 'Test phone']);
    });

    it('schedules: OTP cleanup hourly, session cleanup daily at 21:00 UTC', () => {
      expect(new OtpCleanupJob(sequelize).schedule).toEqual({ pattern: '7 * * * *' });
      expect(new SessionCleanupJob(sequelize).schedule).toEqual({ pattern: '0 21 * * *' });
    });
  });

  it('the log scan catches planted leaks (self-check)', () => {
    const leaks = scanLines(
      [
        '{"msg":"ok","pid":123456}',
        '{"msg":"sent","to":"jane@example.com"}',
        '{"msg":"sms","to":"+919812345678"}',
        '{"msg":"code 482913"}',
        `{"auth":"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlc2lnbmF0dXJl"}`,
        `{"rt":"${randomUUID()}.${'A'.repeat(64)}"}`,
      ],
      new Set(['482913']),
    );
    expect(leaks.map((l) => l.kind)).toEqual(['email', 'phone', 'otp or identifier', 'jwt', 'refresh token']);
    // The capture really holds the app's pino request logs and application logs, and the codes sent.
    expect(capture.lines.filter((l) => l.includes('"req":') && l.includes('/api/v1/auth/')).length).toBeGreaterThan(50);
    expect(capture.lines.some((l) => l.includes('OTP cleanup finished'))).toBe(true);
    expect(capture.secrets.size).toBeGreaterThan(20);
  });
});
