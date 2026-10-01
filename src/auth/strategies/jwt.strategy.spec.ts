import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { UnauthorizedException } from '@nestjs/common';

import { ErrorCode } from '../../common/exceptions/app.exception';
import { UserRole, UserStatus } from '../../users/models/user.model';
import type { SessionState, SessionStateService } from '../session-state/session-state.service';
import { createTestConfig } from '../testing/test-config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  const get = jest.fn();
  const takeRestrictionAuditSlot = jest.fn().mockResolvedValue(true);
  const record = jest.fn().mockResolvedValue(undefined);
  const strategy = new JwtStrategy(
    createTestConfig(),
    { get, takeRestrictionAuditSlot } as unknown as SessionStateService,
    { record } as never,
  );
  const req = { ip: '203.0.113.5', headers: { 'user-agent': 'jest' } } as never;
  const userId = randomUUID();
  const sid = randomUUID();
  const payload = { sub: userId, sid, role: UserRole.User };
  const state = (overrides: Partial<SessionState> = {}): SessionState => ({
    userId,
    role: UserRole.Moderator,
    status: UserStatus.Active,
    deleted: false,
    revoked: false,
    expiresAt: Date.now() + 60_000,
    ...overrides,
  });

  beforeEach(() => {
    get.mockReset();
    record.mockClear();
    takeRestrictionAuditSlot.mockClear();
  });

  it('returns the principal with the role from the session state, not the token', async () => {
    get.mockResolvedValue(state());
    await expect(strategy.validate(req, payload)).resolves.toEqual({ userId, sessionId: sid, role: UserRole.Moderator });
    expect(get).toHaveBeenCalledWith(sid);
  });

  it.each([
    ['null', null],
    ['missing sid', { sub: userId, role: 'user' }],
    ['non-uuid sub', { sub: 'admin', sid, role: 'user' }],
  ])('rejects malformed payload (%s)', async (_l, p) => {
    await expect(strategy.validate(req, p)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown session', null],
    ['revoked', state({ revoked: true })],
    ['expired', state({ expiresAt: Date.now() - 1 })],
    ['another user', state({ userId: randomUUID() })],
  ])('401 for %s', async (_l, s) => {
    get.mockResolvedValue(s);
    await expect(strategy.validate(req, payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([UserStatus.Suspended, UserStatus.Banned, UserStatus.Deactivated])(
    '403 ACCOUNT_RESTRICTED for a %s user with a valid session',
    async (status) => {
      get.mockResolvedValue(state({ status }));
      await expect(strategy.validate(req, payload)).rejects.toMatchObject({ code: ErrorCode.AccountRestricted });
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'auth.account_restricted',
          userId,
          context: expect.objectContaining({ ipAddress: '203.0.113.5' }),
          metadata: { sessionId: sid, status },
        }),
      );
    },
  );

  it('403 ACCOUNT_RESTRICTED for a deleted user', async () => {
    get.mockResolvedValue(state({ deleted: true }));
    await expect(strategy.validate(req, payload)).rejects.toMatchObject({ code: ErrorCode.AccountRestricted });
  });

  it('audits a restricted session at most once per slot', async () => {
    get.mockResolvedValue(state({ status: UserStatus.Banned }));
    takeRestrictionAuditSlot.mockResolvedValueOnce(false);
    await expect(strategy.validate(req, payload)).rejects.toMatchObject({ code: ErrorCode.AccountRestricted });
    expect(record).not.toHaveBeenCalled();
  });
});
