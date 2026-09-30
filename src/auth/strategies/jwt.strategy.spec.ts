import 'reflect-metadata';

import { UnauthorizedException } from '@nestjs/common';

import { UserRole } from '../../users/models/user.model';
import type { SessionService } from '../services/session.service';
import { fakeSession, fakeUser } from '../testing/fakes';
import { createTestConfig } from '../testing/test-config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  const findActiveSession = jest.fn();
  const strategy = new JwtStrategy(createTestConfig(), { findActiveSession } as unknown as SessionService);
  const user = fakeUser();
  const session = fakeSession({ userId: user.id, user });
  const payload = { sub: user.id, sid: session.id, role: UserRole.User };

  beforeEach(() => findActiveSession.mockReset());

  it('returns the principal for an active session', async () => {
    findActiveSession.mockResolvedValue(session);
    await expect(strategy.validate(payload)).resolves.toEqual({
      userId: user.id,
      sessionId: session.id,
      role: UserRole.User,
    });
  });

  it.each([
    ['null', null],
    ['missing sid', { sub: user.id, role: 'user' }],
    ['non-uuid sub', { sub: 'admin', sid: session.id, role: 'user' }],
    ['unknown role', { sub: user.id, sid: session.id, role: 'superuser' }],
  ])('rejects malformed payload (%s)', async (_l, p) => {
    await expect(strategy.validate(p)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findActiveSession).not.toHaveBeenCalled();
  });

  it('rejects revoked/expired (inactive) session', async () => {
    findActiveSession.mockResolvedValue(null);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when session belongs to another user', async () => {
    findActiveSession.mockResolvedValue(fakeSession({ id: session.id, user: fakeUser() }));
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects banned users', async () => {
    const banned = fakeUser({ id: user.id, isBanned: true });
    findActiveSession.mockResolvedValue(fakeSession({ id: session.id, userId: user.id, user: banned }));
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
