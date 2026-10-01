import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { Sequelize } from 'sequelize-typescript';

import { fakeSecurityEvents } from '../auth/testing/fakes';
import type { OutboxService } from '../events/outbox.service';
import { SecurityEventType } from '../security/models/security-event.model';
import { deriveKey, open } from '../common/utils/sealed-box';
import { DELETION_MAIL_KEY_PURPOSE, deletionMailKey } from './account.constants';
import { AccountService } from './account.service';
import { AccountDeletionRegistry } from './registry/account-registry';

const SECRET = 'test-otp-hash-secret-0123456789abcdef0123';
const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest' };
const USER: { id: string; email: string | null; phone: string | null; status: string } = { id: '01890000-0000-7000-8000-000000000001', email: 'jane@example.com', phone: '+919876543210', status: 'active' };

function setup(user: typeof USER | null = USER) {
  const tx = { id: 'tx' };
  const order: string[] = [];
  const registry = new AccountDeletionRegistry();
  const handler = (name: string, o: number, result?: Record<string, number>) => {
    const h = { name, order: o, handle: jest.fn(async () => (order.push(name), result)) };
    registry.register(h);
    return h;
  };
  const users = handler('users', 1000);
  const auth = handler('auth', 10, { revokedSessions: 2 });
  const profile = handler('profile', 30);
  const sequelize = {
    transaction: jest.fn((fn: (t: object) => Promise<unknown>) => fn(tx)),
    query: jest.fn().mockResolvedValue(user ? [user] : []),
  };
  const outbox = { publish: jest.fn().mockResolvedValue('1') };
  const redis = { set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) };
  const events = fakeSecurityEvents();
  const service = new AccountService(
    registry,
    outbox as unknown as OutboxService,
    events,
    redis as unknown as Redis,
    sequelize as unknown as Sequelize,
    new ConfigService({ security: { identifierHashSecret: SECRET } }),
  );
  return { service, tx, order, users, auth, profile, sequelize, outbox, redis, events, registry };
}

describe('AccountService.delete', () => {
  it('locks the user row, runs every registered handler in order in one transaction, then publishes account.deleted', async () => {
    const s = setup();
    await s.service.delete(USER.id, ctx);
    expect(s.sequelize.transaction).toHaveBeenCalledTimes(1);
    expect(s.sequelize.query.mock.calls[0][0]).toMatch(/FOR UPDATE$/);
    expect(s.order).toEqual(['auth', 'profile', 'users']);
    for (const h of [s.auth, s.profile, s.users]) expect(h.handle).toHaveBeenCalledWith(USER.id, s.tx);
    expect(s.outbox.publish).toHaveBeenCalledWith('account.deleted', USER.id, { userId: USER.id }, s.tx);
  });

  it('the outbox event carries the user id only; the address waits in Redis (24 h), AES-GCM sealed, for the mail handler', async () => {
    const s = setup();
    await s.service.delete(USER.id, ctx);
    expect(JSON.stringify(s.outbox.publish.mock.calls)).not.toContain(USER.email);
    const [key, value, ex, ttl] = s.redis.set.mock.calls[0] as [string, string, string, number];
    expect([key, ex, ttl]).toEqual([deletionMailKey(USER.id), 'EX', 86_400]);
    expect(value).not.toContain('jane');
    expect(open(deriveKey(SECRET, DELETION_MAIL_KEY_PURPOSE), value, USER.id)).toBe(USER.email);
    // Written before any handler scrubs the row.
    expect(s.redis.set.mock.invocationCallOrder[0]).toBeLessThan(s.auth.handle.mock.invocationCallOrder[0]);
  });

  it('no email on the account → no Redis key, so no confirmation email', async () => {
    const s = setup({ ...USER, email: null });
    await s.service.delete(USER.id, ctx);
    expect(s.redis.set).not.toHaveBeenCalled();
  });

  it('audits account.deleted with 12-char identifier prefixes and handler counts only', async () => {
    const s = setup();
    await s.service.delete(USER.id, ctx);
    const [[event]] = s.events.record.mock.calls as [[{ eventType: string; metadata: Record<string, unknown>; transaction: unknown }]];
    expect(event.eventType).toBe(SecurityEventType.AccountDeleted);
    expect(event.transaction).toBe(s.tx);
    expect(event.metadata).toEqual({
      wasBanned: false,
      identifierHashPrefixes: ['h:email:jane', 'h:phone:+919'],
      handlers: ['auth', 'profile', 'users'],
      results: { auth: { revokedSessions: 2 } },
    });
    expect(JSON.stringify(event.metadata)).not.toMatch(/jane@example\.com|9876543210/);
    expect((s.events.record.mock.calls[0][0] as { strict: boolean }).strict).toBe(true);
  });

  it('a failing handler rolls everything back: later handlers do not run, no event, and the Redis key is removed', async () => {
    const s = setup();
    s.profile.handle.mockRejectedValueOnce(new Error('db down'));
    await expect(s.service.delete(USER.id, ctx)).rejects.toThrow('db down');
    expect(s.users.handle).not.toHaveBeenCalled();
    expect(s.outbox.publish).not.toHaveBeenCalled();
    expect(s.redis.del).toHaveBeenCalledWith(deletionMailKey(USER.id));
  });

  it('an unknown or already deleted user → 404 USER_NOT_FOUND, nothing runs', async () => {
    const s = setup(null);
    await expect(s.service.delete(USER.id, ctx)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    expect(s.auth.handle).not.toHaveBeenCalled();
  });

  it('Redis down: the deletion still happens, without the confirmation email', async () => {
    const s = setup();
    s.redis.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await s.service.delete(USER.id, ctx);
    expect(s.users.handle).toHaveBeenCalled();
    expect(s.outbox.publish).toHaveBeenCalled();
  });
});
