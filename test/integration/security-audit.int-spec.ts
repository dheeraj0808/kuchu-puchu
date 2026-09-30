import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/sequelize';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConnectionError, QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import request from 'supertest';

import { IdentifierType } from '../../src/auth/models/otp-verification.model';
import { OtpDeliveryService } from '../../src/auth/services/otp-delivery.service';
import { SessionService } from '../../src/auth/services/session.service';
import { TokenService } from '../../src/auth/services/token.service';
import { SessionStateService } from '../../src/auth/session-state/session-state.service';
import type { SecurityConfig } from '../../src/config/security.config';
import {
  SecurityEvent,
  SecurityEventType,
} from '../../src/security/models/security-event.model';
import * as securityMigration from '../../src/database/migrations/20261005000001-security-events-bigint-actor';
import { SecurityRetentionJob } from '../../src/security/security-retention.job';
import { SecurityEventsService } from '../../src/security/security-events.service';
import { UserRole, UserStatus } from '../../src/users/models/user.model';
import { RevokeSessionsHandler } from '../../src/users/revoke-sessions.handler';
import { UsersService } from '../../src/users/users.service';
import { createTestApp } from '../support/test-app';
import { clearTestKeys } from '../support/test-redis';

interface Row {
  id: string;
  event_type: string;
  user_id: string | null;
  actor_user_id: string | null;
  metadata: Record<string, unknown> | null;
}

describe('M05 Security audit (MySQL + Redis)', () => {
  let app: NestExpressApplication;
  let sequelize: Sequelize;
  let ipCounter = 0;
  const ip = (): string =>
    `198.18.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

  beforeAll(async () => {
    await clearTestKeys(process.env.REDIS_URL as string);
    app = await createTestApp();
    await app.init();
    sequelize = app.get<Sequelize>(getConnectionToken());
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(() => jest.restoreAllMocks());

  const eventsFor = (userId: string): Promise<Row[]> =>
    sequelize.query<Row>(
      'SELECT id, event_type, user_id, actor_user_id, metadata FROM security_events WHERE user_id = :userId ORDER BY id',
      { replacements: { userId }, type: QueryTypes.SELECT },
    );

  /** Signs in through the real API, capturing the OTP at the delivery adapter. */
  async function login(
    email: string,
    from = ip(),
  ): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
    let code = '';
    jest
      .spyOn(app.get(OtpDeliveryService), 'send')
      .mockImplementation(async (_t, _i, otp) => {
        code = otp;
      });
    const server = app.getHttpServer();
    await request(server)
      .post('/api/v1/auth/request-otp')
      .set('X-Forwarded-For', from)
      .send({ identifierType: 'email', identifier: email })
      .expect(200);
    const res = await request(server)
      .post('/api/v1/auth/verify-otp')
      .set('X-Forwarded-For', from)
      .send({ identifierType: 'email', identifier: email, otp: code })
      .expect(200);
    return {
      accessToken: res.body.data.accessToken,
      refreshToken: res.body.data.refreshToken,
      userId: res.body.data.user.id,
    };
  }

  it('the table matches the spec (BIGINT id, actor_user_id, user_agent 255, indexes)', async () => {
    const cols = await sequelize.query<{ name: string; type: string }>(
      `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'security_events' ORDER BY ORDINAL_POSITION`,
      { type: QueryTypes.SELECT },
    );
    expect(Object.fromEntries(cols.map((c) => [c.name, c.type]))).toEqual({
      id: 'bigint unsigned',
      user_id: 'char(36)',
      actor_user_id: 'char(36)',
      event_type: 'varchar(64)',
      ip_address: 'varchar(45)',
      user_agent: 'varchar(255)',
      metadata: 'json',
      created_at: 'datetime(3)',
    });
    const idx = await sequelize.query<{ name: string; cols: string }>(
      `SELECT INDEX_NAME AS name, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'security_events' GROUP BY INDEX_NAME`,
      { type: QueryTypes.SELECT },
    );
    expect(idx.map((i) => i.cols)).toEqual(
      expect.arrayContaining(['user_id,created_at', 'event_type,created_at']),
    );
  });

  it('a failing insert (DB down) never breaks the calling request', async () => {
    jest
      .spyOn(SecurityEvent, 'create')
      .mockRejectedValue(new ConnectionError(new Error('ECONNREFUSED')));
    jest
      .spyOn(app.get(OtpDeliveryService), 'send')
      .mockResolvedValue(undefined);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/request-otp')
      .set('X-Forwarded-For', ip())
      .send({
        identifierType: 'email',
        identifier: `down.${randomUUID().slice(0, 8)}@example.com`,
      });
    expect(res.status).toBe(200);
    await expect(
      app
        .get(SecurityEventsService)
        .record({ eventType: SecurityEventType.Logout }),
    ).resolves.toBeUndefined();
  });

  it('nested PII keys never reach the table', async () => {
    const userId = (await login(`pii.${randomUUID().slice(0, 8)}@example.com`))
      .userId;
    await app.get(SecurityEventsService).record({
      eventType: SecurityEventType.Logout,
      userId,
      metadata: {
        keep: 1,
        Phone: '+919812345678',
        nested: {
          EMAIL: 'jane@example.com',
          deeper: [{ otp: '123456', token: 'abc', ok: true }],
          Lat: 12.9,
          lng: 77.6,
        },
        identifier: 'jane@example.com',
        password: 'x',
      },
    });
    const rows = await eventsFor(userId);
    const stored = rows.find(
      (r) => r.metadata && 'keep' in r.metadata,
    )?.metadata;
    expect(stored).toEqual({ keep: 1, nested: { deeper: [{ ok: true }] } });
    const all = JSON.stringify(rows);
    for (const leak of [
      '+919812345678',
      'jane@example.com',
      '123456',
      'abc',
      '12.9',
      '77.6',
    ])
      expect(all).not.toContain(leak);
  });

  it('every auth and M04 action creates its event', async () => {
    const email = `audit.${randomUUID().slice(0, 8)}@example.com`;
    const from = ip();
    const server = app.getHttpServer();
    const first = await login(email, from);

    await request(server)
      .post('/api/v1/auth/verify-otp')
      .set('X-Forwarded-For', from)
      .send({ identifierType: 'email', identifier: email, otp: '000000' })
      .expect(401);
    const refreshed = await request(server)
      .post('/api/v1/auth/refresh')
      .set('X-Forwarded-For', from)
      .send({ refreshToken: first.refreshToken })
      .expect(200);
    await request(server)
      .post('/api/v1/auth/logout')
      .set('X-Forwarded-For', from)
      .send({ refreshToken: refreshed.body.data.refreshToken })
      .expect(200);
    const openSession = async (): Promise<{ accessToken: string }> => {
      const { session } = await app
        .get(SessionService)
        .create(first.userId, {}, { ipAddress: from, userAgent: 'jest' });
      const signed = await app.get(TokenService).signAccessToken({
        sub: first.userId,
        sid: session.id,
        role: UserRole.User,
      });
      return { accessToken: signed.token };
    };
    // More OTPs for the same email would hit the resend cooldown; open these sessions directly.
    const second = await openSession();
    await request(server)
      .post('/api/v1/auth/logout-all')
      .set('X-Forwarded-For', from)
      .set('Authorization', `Bearer ${second.accessToken}`)
      .expect(200);

    // M04: status change with an actor, restricted request, sessions revoked by restriction.
    const third = await openSession();
    const actor = (await login(`mod.${randomUUID().slice(0, 8)}@example.com`))
      .userId;
    await app
      .get(UsersService)
      .setStatus(first.userId, UserStatus.Banned, 'test.ban', {
        actorUserId: actor,
      });
    await request(server)
      .get('/api/v1/auth/me')
      .set('X-Forwarded-For', from)
      .set('Authorization', `Bearer ${third.accessToken}`)
      .expect(403);
    const [event] = await sequelize.query<{
      id: string;
      payload: { userId: string; from: string; to: string };
    }>(
      `SELECT id, payload FROM outbox_events WHERE event_type = 'user.status_changed' AND aggregate_id = :id`,
      { replacements: { id: first.userId }, type: QueryTypes.SELECT },
    );
    await new RevokeSessionsHandler(
      sequelize,
      app.get(SessionStateService),
      app.get(SecurityEventsService),
    ).handle({
      outboxId: String(event.id),
      type: 'user.status_changed',
      aggregateId: first.userId,
      payload: event.payload,
      attempt: 1,
    });

    const rows = await eventsFor(first.userId);
    const types = rows.map((r) => r.event_type);
    for (const expected of [
      'user.registered',
      'auth.login_succeeded',
      'auth.token_refreshed',
      'auth.logout',
      'auth.logout_all',
      'user.status_changed',
      'auth.account_restricted',
      'auth.session_revoked',
    ]) {
      expect(types).toContain(expected);
    }
    const status = rows.find((r) => r.event_type === 'user.status_changed');
    expect(status?.actor_user_id).toBe(actor);
    expect(status?.metadata).toMatchObject({
      from: 'active',
      to: 'banned',
      reason: 'test.ban',
    });
    // otp.requested and a failed verify come before/without a user: found by the identifier's hash prefix.
    const prefix = app
      .get(SecurityEventsService)
      .hashIdentifier(IdentifierType.Email, email);
    const anonymous = await sequelize.query<{ event_type: string }>(
      `SELECT event_type FROM security_events WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.identifierHashPrefix')) = :prefix`,
      { replacements: { prefix }, type: QueryTypes.SELECT },
    );
    expect(anonymous.map((r) => r.event_type)).toEqual(
      expect.arrayContaining(['otp.requested', 'otp.verification_failed']),
    );
    // The failed verify has no user; it is recorded with the identifier's 12-char hash prefix only.
    const failed = await sequelize.query<Row>(
      `SELECT metadata FROM security_events WHERE event_type = 'otp.verification_failed' ORDER BY id DESC LIMIT 1`,
      { type: QueryTypes.SELECT },
    );
    expect(String(failed[0].metadata?.identifierHashPrefix)).toMatch(
      /^[0-9a-f]{12}$/,
    );
    // Identifiers never appear in any event of this user.
    expect(JSON.stringify(rows)).not.toContain(email);
    for (const r of rows) {
      const prefix = r.metadata?.identifierHashPrefix;
      if (prefix !== undefined)
        expect(String(prefix)).toMatch(/^[0-9a-f]{12}$/);
    }
  });

  it('retention deletes only non-admin events older than 365 days and admin.* older than 3 years', async () => {
    const marker = randomUUID();
    const seed = async (type: string, daysAgo: number): Promise<void> => {
      await sequelize.query(
        `INSERT INTO security_events (event_type, metadata, created_at) VALUES (:type, JSON_OBJECT('marker', :marker, 'age', :daysAgo), NOW(3) - INTERVAL :daysAgo DAY)`,
        { replacements: { type, marker, daysAgo } },
      );
    };
    await seed('auth.logout', 366); // deleted
    await seed('auth.logout', 364); // kept
    await seed('admin.user_banned', 366); // kept (admin: 3 years)
    await seed('admin.user_banned', 1096); // deleted
    await seed('admin.user_banned', 1094); // kept
    await seed('adminx.other', 366); // not admin.* → deleted
    for (let i = 0; i < 5; i++) await seed('otp.requested', 400); // deleted, in batches

    // The job runs in the worker; the API app only provides its dependencies.
    const retention = new SecurityRetentionJob(
      sequelize,
      app.get(ConfigService),
    );
    expect(retention.schedule).toEqual({ pattern: '45 21 * * *' });
    const cfg = {
      ...app.get(ConfigService).getOrThrow<SecurityConfig>('security'),
      retentionBatchSize: 2,
    };
    await retention.deleteExpired(cfg);

    const left = await sequelize.query<{ event_type: string; age: number }>(
      `SELECT event_type, CAST(JSON_EXTRACT(metadata, '$.age') AS UNSIGNED) AS age FROM security_events
        WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.marker')) = :marker ORDER BY event_type, age`,
      { replacements: { marker }, type: QueryTypes.SELECT },
    );
    expect(left.map((r) => [r.event_type, Number(r.age)])).toEqual([
      ['admin.user_banned', 366],
      ['admin.user_banned', 1094],
      ['auth.logout', 364],
    ]);
  });

  it('the migration rebuilds a legacy (UUID id) table: every row copied in order, user_agent cut to 255, FK restored', async () => {
    await sequelize.query('RENAME TABLE security_events TO security_events_keep');
    // FK names are schema-wide; the kept table must not hold the name the migration creates.
    await sequelize.query('ALTER TABLE security_events_keep DROP FOREIGN KEY security_events_user_id_fk');
    try {
      await sequelize.query(`
        CREATE TABLE security_events (
          id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
          user_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
          event_type VARCHAR(64) NOT NULL,
          ip_address VARCHAR(45) NULL,
          user_agent VARCHAR(512) NULL,
          metadata JSON NULL,
          created_at DATETIME(3) NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
      for (const [i, ua] of [
        ['2', 'short'],
        ['1', 'x'.repeat(400)],
        ['3', null],
      ] as const) {
        await sequelize.query(
          `INSERT INTO security_events (id, event_type, user_agent, metadata, created_at)
           VALUES (:id, 'auth.logout', :ua, JSON_OBJECT('n', :i), NOW(3) - INTERVAL :i MINUTE)`,
          { replacements: { id: randomUUID(), ua, i: Number(i) } },
        );
      }
      await securityMigration.up({
        context: sequelize.getQueryInterface(),
        name: 'test',
        path: undefined,
      } as never);
      const rows = await sequelize.query<{
        id: string;
        n: number;
        ua: number | null;
      }>(
        `SELECT id, CAST(JSON_EXTRACT(metadata, '$.n') AS UNSIGNED) AS n, CHAR_LENGTH(user_agent) AS ua FROM security_events ORDER BY id`,
        { type: QueryTypes.SELECT },
      );
      // Oldest first (n = minutes ago): 3, 2, 1 → ids 1, 2, 3.
      expect(
        rows.map((r) => [
          Number(r.id),
          Number(r.n),
          r.ua === null ? null : Number(r.ua),
        ]),
      ).toEqual([
        [1, 3, null],
        [2, 2, 5],
        [3, 1, 255],
      ]);
      const [{ fks }] = await sequelize.query<{ fks: number }>(
        `SELECT COUNT(*) AS fks FROM information_schema.TABLE_CONSTRAINTS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'security_events' AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
        { type: QueryTypes.SELECT },
      );
      expect(Number(fks)).toBe(1);
      expect(
        await sequelize.getQueryInterface().tableExists('security_events_old'),
      ).toBe(false);
      expect(
        await sequelize.getQueryInterface().describeTable('security_events'),
      ).not.toHaveProperty('legacy_id');
    } finally {
      await sequelize.query('DROP TABLE IF EXISTS security_events');
      await sequelize.query('RENAME TABLE security_events_keep TO security_events');
      await sequelize.query(
        'ALTER TABLE security_events ADD CONSTRAINT security_events_user_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE',
      );
    }
  });
});
