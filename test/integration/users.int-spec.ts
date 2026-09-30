import { randomUUID } from 'node:crypto';

import { getConnectionToken, getModelToken } from '@nestjs/sequelize';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Redis } from 'ioredis';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import request from 'supertest';

import { IdentifierType } from '../../src/auth/models/otp-verification.model';
import { AuthService } from '../../src/auth/auth.service';
import { OtpService } from '../../src/auth/services/otp.service';
import { SessionService } from '../../src/auth/services/session.service';
import { TokenService } from '../../src/auth/services/token.service';
import {
  SessionStateService,
  sessionCacheKey,
} from '../../src/auth/session-state/session-state.service';
import * as usersMigration from '../../src/database/migrations/20261004000001-users-status-and-activity';
import { REDIS_CLIENT } from '../../src/infra/redis/redis.module';
import { SecurityEventsService } from '../../src/security/security-events.service';
import { User, UserRole, UserStatus } from '../../src/users/models/user.model';
import { RevokeSessionsHandler } from '../../src/users/revoke-sessions.handler';
import { UsersService } from '../../src/users/users.service';
import { createTestApp } from '../support/test-app';
import { waitUntil } from '../support/outbox-harness';

const ctx = { ipAddress: '203.0.113.9', userAgent: 'jest' };

/** A random valid Indian mobile number, e.g. +9198xxxxxxxx. */
const indianMobile = (): string =>
  `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

describe('M04 Users (MySQL + Redis)', () => {
  let app: NestExpressApplication;
  let sequelize: Sequelize;
  let users: UsersService;
  let redis: Redis;

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    sequelize = app.get<Sequelize>(getConnectionToken());
    users = app.get(UsersService);
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  afterAll(async () => {
    await app?.close();
  });

  async function signedIn(): Promise<{
    userId: string;
    sessionId: string;
    token: string;
  }> {
    const { user } = await users.createVerified(
      IdentifierType.Phone,
      indianMobile(),
    );
    const { session } = await app.get(SessionService).create(user.id, {}, ctx);
    const { token } = await app
      .get(TokenService)
      .signAccessToken({ sub: user.id, sid: session.id, role: UserRole.User });
    return { userId: user.id, sessionId: session.id, token };
  }

  const me = (token: string): request.Test =>
    request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

  it('normalisation: mixed-case email and spaced / local / +91 phone forms all map to the same user', async () => {
    const digits = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    const { user } = await users.createVerified(
      IdentifierType.Phone,
      `+91 98${digits.slice(0, 3)} ${digits.slice(3)}`,
    );
    for (const form of [
      `98${digits}`,
      `098${digits}`,
      `+9198${digits}`,
      `(+91) 98${digits.slice(0, 3)}-${digits.slice(3)}`,
    ]) {
      expect(
        (await users.findByIdentifier(IdentifierType.Phone, form))?.id,
      ).toBe(user.id);
    }
    expect(user.phone).toBe(`+9198${digits}`);

    const local = `jane.${randomUUID().slice(0, 8)}`;
    const { user: byEmail } = await users.createVerified(
      IdentifierType.Email,
      `  ${local.toUpperCase()}@Example.COM `,
    );
    expect(byEmail.email).toBe(`${local}@example.com`);
    expect(
      (
        await users.findByIdentifier(
          IdentifierType.Email,
          `${local}@EXAMPLE.com`,
        )
      )?.id,
    ).toBe(byEmail.id);
    // A second insert of another form of the same identifier returns the same user.
    expect(
      await users.createVerified(IdentifierType.Email, `${local}@example.com`),
    ).toMatchObject({
      user: { id: byEmail.id },
      created: false,
    });
    await expect(
      users.findByIdentifier(IdentifierType.Phone, '12345'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('an invalid phone is a 400 VALIDATION_ERROR at the API', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/request-otp')
      .set('X-Forwarded-For', '198.51.100.77')
      .send({ identifierType: 'phone', identifier: '+910000000000' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('10 parallel OTP verifies for one new phone create exactly one user (real verifyOtp)', async () => {
    const phone = indianMobile();
    const local = phone.replace('+91', '');
    const otp = app.get(OtpService);
    const auth = app.get(AuthService);
    const userModel = app.get<typeof User>(getModelToken(User));
    const create = jest.spyOn(userModel, 'create');
    // Ten valid codes for the same phone, verified at the same time through the real service.
    const verifySpy = jest.spyOn(otp, 'verify');
    verifySpy.mockImplementation(
      async () => ({ ok: true, record: { id: randomUUID() } }) as never,
    );
    jest.spyOn(otp, 'linkUser').mockResolvedValue(undefined as never);
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          auth.verifyOtp(
            {
              identifierType: IdentifierType.Phone,
              identifier: i % 2 ? local : phone,
              otp: '123456',
            } as never,
            ctx,
          ),
        ),
      );
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(rejected.map((r) => `${(r.reason as Error).name}:${(r.reason as { parent?: { errno?: number } }).parent?.errno ?? ''}:${(r.reason as Error).message.slice(0, 80)}`)).toEqual([]);
      const userIds = results.map(
        (r) =>
          (r as PromiseFulfilledResult<{ user: { id: string } }>).value.user.id,
      );
      expect(new Set(userIds).size).toBe(1);
      const [{ n }] = await sequelize.query<{ n: number }>(
        'SELECT COUNT(*) AS n FROM users WHERE phone = :phone',
        {
          replacements: { phone },
          type: QueryTypes.SELECT,
        },
      );
      expect(Number(n)).toBe(1);
      // The race really happened: more than one request tried the insert, only one succeeded.
      const outcomes = await Promise.allSettled(
        create.mock.results.map((r) => r.value as Promise<unknown>),
      );
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(
        outcomes.filter((o) => o.status === 'rejected').length,
      ).toBeGreaterThanOrEqual(1);
    } finally {
      jest.restoreAllMocks();
    }
  });

  it.each([UserStatus.Banned, UserStatus.Suspended])(
    '%s user with a valid token → 403 ACCOUNT_RESTRICTED on the next request (cache invalidated, not the TTL)',
    async (status) => {
      const { userId, sessionId, token } = await signedIn();
      await me(token).expect(200);
      expect(await redis.exists(sessionCacheKey(sessionId))).toBe(1);

      const actor = (await signedIn()).userId;
      await users.setStatus(userId, status, 'test.policy', {
        actorUserId: actor,
        ...(status === UserStatus.Suspended
          ? { until: new Date(Date.now() + 86_400_000) }
          : {}),
      });
      // setStatus returns only after the cache is dropped (afterCommit is awaited).
      expect(await redis.exists(sessionCacheKey(sessionId))).toBe(0);
      const res = await me(token);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_RESTRICTED');
    },
  );

  it('setStatus → user.status_changed in the outbox → handler revokes the sessions; running it twice changes nothing', async () => {
    const a = await signedIn();
    const second = await app.get(SessionService).create(a.userId, {}, ctx);
    await users.setStatus(a.userId, UserStatus.Banned, 'test.ban');

    const [event] = await sequelize.query<{
      id: string;
      payload: { userId: string; from: string; to: string };
    }>(
      `SELECT id, payload FROM outbox_events WHERE event_type = 'user.status_changed' AND aggregate_id = :id`,
      { replacements: { id: a.userId }, type: QueryTypes.SELECT },
    );
    expect(event.payload).toEqual({
      userId: a.userId,
      from: 'active',
      to: 'banned',
    });

    const handler = new RevokeSessionsHandler(
      sequelize,
      app.get(SessionStateService),
      app.get(SecurityEventsService),
    );
    const delivered = {
      outboxId: String(event.id),
      type: 'user.status_changed' as const,
      aggregateId: a.userId,
      payload: event.payload,
      attempt: 1,
    };
    const sessions = async (): Promise<
      Array<{
        id: string;
        revoked_at: Date | null;
        revoked_reason: string | null;
      }>
    > =>
      sequelize.query(
        `SELECT id, revoked_at, revoked_reason FROM sessions WHERE user_id = :id ORDER BY id`,
        {
          replacements: { id: a.userId },
          type: QueryTypes.SELECT,
        },
      );

    await handler.handle(delivered);
    const after = await sessions();
    expect(after).toHaveLength(2);
    expect(
      after.every(
        (s) => s.revoked_at !== null && s.revoked_reason === 'restricted',
      ),
    ).toBe(true);
    expect(
      await redis.exists(
        sessionCacheKey(a.sessionId),
        sessionCacheKey(second.session.id),
      ),
    ).toBe(0);

    await handler.handle({ ...delivered, attempt: 2 });
    expect(await sessions()).toEqual(after);
    // Revoked now: 401, not 403.
    await me(a.token).expect(401);
  });

  it('the handler does nothing if the user was reactivated before it ran', async () => {
    const a = await signedIn();
    await users.setStatus(a.userId, UserStatus.Banned, 'test.ban');
    await users.setStatus(a.userId, UserStatus.Active, 'test.appeal');
    const handler = new RevokeSessionsHandler(
      sequelize,
      app.get(SessionStateService),
      app.get(SecurityEventsService),
    );
    await handler.handle({
      outboxId: '1',
      type: 'user.status_changed',
      aggregateId: a.userId,
      payload: { userId: a.userId, from: 'active', to: 'banned' },
      attempt: 1,
    });
    await me(a.token).expect(200);
  });

  it('touchLastActive writes at most once per 5 minutes per user', async () => {
    const a = await signedIn();
    const lastActive = async (): Promise<Date | null> => {
      const [row] = await sequelize.query<{ last_active_at: Date | null }>(
        'SELECT last_active_at FROM users WHERE id = :id',
        { replacements: { id: a.userId }, type: QueryTypes.SELECT },
      );
      return row.last_active_at;
    };
    expect(await lastActive()).toBeNull();
    await me(a.token).expect(200);
    await waitUntil(
      async () => (await lastActive()) !== null,
      3_000,
      'last_active_at',
    );
    const first = (await lastActive()) as Date;
    const ttl = await redis.ttl(`kp:active:${a.userId}`);
    expect(ttl).toBeGreaterThan(290);
    expect(ttl).toBeLessThanOrEqual(300);

    for (let i = 0; i < 5; i++) await me(a.token).expect(200);
    await new Promise((r) => setTimeout(r, 200));
    expect((await lastActive())?.getTime()).toBe(first.getTime());

    // Once the throttle key is gone (5 minutes later), the next request writes again.
    await redis.del(`kp:active:${a.userId}`);
    await new Promise((r) => setTimeout(r, 5));
    await me(a.token).expect(200);
    await waitUntil(
      async () => ((await lastActive()) as Date).getTime() > first.getTime(),
      3_000,
      'second write',
    );
  });

  it('health requests never touch last activity', async () => {
    const a = await signedIn();
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(await redis.exists(`kp:active:${a.userId}`)).toBe(0);
  });
});

describe('M04 users migration (is_banned → status)', () => {
  let app: NestExpressApplication;
  let sequelize: Sequelize;

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    sequelize = app.get<Sequelize>(getConnectionToken());
  });

  afterAll(async () => {
    await app?.close();
  });

  const counts = async (): Promise<Record<string, number>> => {
    const rows = await sequelize.query<{ status: string; n: number }>(
      'SELECT status, COUNT(*) AS n FROM users GROUP BY status ORDER BY status',
      { type: QueryTypes.SELECT },
    );
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  };

  it('seeded is_banned / deleted rows end with the right status, and is_banned is dropped', async () => {
    const qi = sequelize.getQueryInterface();
    await usersMigration.down({
      context: qi,
      name: 'test',
      path: undefined,
    } as never);
    const ids = {
      banned: randomUUID(),
      bannedDeleted: randomUUID(),
      deleted: randomUUID(),
      suspended: randomUUID(),
      plain: randomUUID(),
    };
    const seed = async (
      id: string,
      status: string,
      isBanned: number,
      deleted: boolean,
    ): Promise<void> => {
      await sequelize.query(
        `INSERT INTO users (id, status, role, is_active, is_banned, created_at, updated_at, deleted_at)
         VALUES (:id, :status, 'user', 1, :isBanned, NOW(3), NOW(3), ${deleted ? 'NOW(3)' : 'NULL'})`,
        { replacements: { id, status, isBanned } },
      );
    };
    await seed(ids.banned, 'active', 1, false);
    await seed(ids.bannedDeleted, 'active', 1, true);
    await seed(ids.deleted, 'active', 0, true);
    await seed(ids.suspended, 'suspended', 0, false);
    await seed(ids.plain, 'active', 0, false);
    const before = await counts();

    await usersMigration.up({
      context: qi,
      name: 'test',
      path: undefined,
    } as never);

    const status = async (id: string): Promise<string> =>
      (
        await sequelize.query<{ status: string }>(
          'SELECT status FROM users WHERE id = :id',
          {
            replacements: { id },
            type: QueryTypes.SELECT,
          },
        )
      )[0].status;
    expect(await status(ids.banned)).toBe('banned');
    expect(await status(ids.bannedDeleted)).toBe('banned');
    expect(await status(ids.deleted)).toBe('deactivated');
    expect(await status(ids.suspended)).toBe('suspended');
    expect(await status(ids.plain)).toBe('active');
    const cols = await qi.describeTable('users');
    expect(cols).not.toHaveProperty('is_banned');
    expect(cols).toHaveProperty('last_active_at');
    expect(cols).toHaveProperty('suspended_until');
    expect(cols).toHaveProperty('discovery_restricted_at');
    expect((cols as Record<string, { type: string }>).phone.type).toBe(
      'VARCHAR(16)',
    );
    const after = await counts();
    // Printed so the before/after per-status counts are visible in the test log.
    console.log(
      `[M04 migration] before ${JSON.stringify(before)} after ${JSON.stringify(after)}`,
    );
    expect(Object.values(after).reduce((a, b) => a + b, 0)).toBe(
      Object.values(before).reduce((a, b) => a + b, 0),
    );

    await sequelize.query('DELETE FROM users WHERE id IN (:ids)', {
      replacements: { ids: Object.values(ids) },
    });
  });
});
