import 'reflect-metadata';

import { HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AppException, ErrorCode } from '../../common/exceptions/app.exception';
import { SecurityEventType } from '../../security/models/security-event.model';
import type { Session } from '../models/session.model';
import { createTestConfig } from '../testing/test-config';
import { fakeSecurityEvents, fakeSession, fakeUser } from '../testing/fakes';
import { SessionRevokeReason, SessionService } from './session.service';
import { TokenService } from './token.service';

const ctx = { ipAddress: '198.51.100.7', userAgent: 'jest' };

interface SessionModelMock {
  findByPk: jest.Mock;
  findOne: jest.Mock;
  update: jest.Mock;
  create: jest.Mock;
}

function setup() {
  const tokens = new TokenService(new JwtService(), createTestConfig());
  const model: SessionModelMock = {
    findByPk: jest.fn().mockResolvedValue(null),
    findOne: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue([1]),
    create: jest.fn((attrs: Record<string, unknown>) => Promise.resolve(fakeSession(attrs as Partial<Session>))),
  };
  const events = fakeSecurityEvents();
  const service = new SessionService(model as unknown as typeof Session, tokens, events);
  return { service, model, tokens, events };
}

/** Creates a session through the service and returns a matching stored row. */
async function loggedIn(s: ReturnType<typeof setup>) {
  const user = fakeUser();
  const { session, refreshToken } = await s.service.create(user.id, {}, ctx);
  const stored = fakeSession({ ...session, user } as Partial<Session>);
  s.model.findByPk.mockResolvedValue(stored);
  s.model.update.mockClear();
  return { user, stored, refreshToken };
}

async function expectAppError(p: Promise<unknown>, code: ErrorCode, status: HttpStatus): Promise<void> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppException);
  expect((err as AppException).code).toBe(code);
  expect((err as AppException).getStatus()).toBe(status);
}

describe('SessionService', () => {
  it('create stores only a hash; token = sessionId.secret', async () => {
    const s = setup();
    const { session, refreshToken } = await s.service.create('u1', { deviceId: 'dev-1' }, ctx);
    const parsed = s.tokens.parseRefreshToken(refreshToken);
    expect(parsed?.sessionId).toBe(session.id);
    const attrs = s.model.create.mock.calls[0][0] as Record<string, unknown>;
    expect(attrs.refreshTokenHash).toBe(s.tokens.hashRefreshSecret(parsed!.secret));
    expect(JSON.stringify(attrs)).not.toContain(parsed!.secret);
    // same-device sessions are replaced
    expect(s.model.update).toHaveBeenCalledWith(
      expect.objectContaining({ revokedReason: SessionRevokeReason.ReplacedByNewLogin }),
      expect.objectContaining({ where: { userId: 'u1', deviceId: 'dev-1', revokedAt: null } }),
    );
  });

  describe('rotate', () => {
    it('rotates: new token differs, hash updated, previous hash stored', async () => {
      const s = setup();
      const { stored, refreshToken } = await loggedIn(s);
      const oldHash = stored.refreshTokenHash;

      const result = await s.service.rotate(refreshToken, ctx);

      expect(result.refreshToken).not.toBe(refreshToken);
      const newSecret = s.tokens.parseRefreshToken(result.refreshToken)!.secret;
      const [changes, opts] = s.model.update.mock.calls[0] as [Record<string, unknown>, { where: Record<string, unknown> }];
      expect(changes.refreshTokenHash).toBe(s.tokens.hashRefreshSecret(newSecret));
      expect(changes.refreshTokenHash).not.toBe(oldHash);
      expect(changes.previousRefreshTokenHash).toBe(oldHash);
      expect(opts.where).toEqual({ id: stored.id, refreshTokenHash: oldHash, revokedAt: null });
      expect(result.session.refreshTokenHash).toBe(changes.refreshTokenHash);
    });

    it('detects reuse of a rotated token and revokes the session', async () => {
      const s = setup();
      const { stored, refreshToken } = await loggedIn(s);
      await s.service.rotate(refreshToken, ctx); // stored now holds new hash + previous
      s.model.update.mockClear();

      await expectAppError(s.service.rotate(refreshToken, ctx), ErrorCode.InvalidRefreshToken, HttpStatus.UNAUTHORIZED);

      expect(s.model.update).toHaveBeenCalledWith(
        expect.objectContaining({ revokedReason: SessionRevokeReason.RefreshTokenReuse }),
        { where: { id: stored.id, revokedAt: null } },
      );
      expect(s.events.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: SecurityEventType.RefreshTokenReuseDetected }),
      );
    });

    it.each([
      ['garbage', 'not-a-token-at-all-xxxxxxxx'],
      ['bad uuid', `1234.${'a'.repeat(64)}`],
      ['short secret', '6f1c2e0a-8a1b-4c2d-9e3f-0a1b2c3d4e5f.abc'],
    ])('rejects malformed token (%s) with 401', async (_label, token) => {
      const s = setup();
      await expectAppError(s.service.rotate(token, ctx), ErrorCode.InvalidRefreshToken, HttpStatus.UNAUTHORIZED);
      expect(s.model.findByPk).not.toHaveBeenCalled();
    });

    it('rejects a well-formed token with wrong secret without revoking', async () => {
      const s = setup();
      const { stored } = await loggedIn(s);
      const forged = s.tokens.buildRefreshToken(stored.id, s.tokens.generateRefreshSecret());
      await expectAppError(s.service.rotate(forged, ctx), ErrorCode.InvalidRefreshToken, HttpStatus.UNAUTHORIZED);
      expect(s.model.update).not.toHaveBeenCalled();
    });

    it('rejects revoked, expired and unknown sessions', async () => {
      const s = setup();
      const { stored, refreshToken } = await loggedIn(s);
      stored.revokedAt = new Date();
      await expectAppError(s.service.rotate(refreshToken, ctx), ErrorCode.InvalidRefreshToken, HttpStatus.UNAUTHORIZED);
      stored.revokedAt = null;
      stored.expiresAt = new Date(Date.now() - 1000);
      await expectAppError(s.service.rotate(refreshToken, ctx), ErrorCode.InvalidRefreshToken, HttpStatus.UNAUTHORIZED);
      s.model.findByPk.mockResolvedValue(null);
      await expectAppError(s.service.rotate(refreshToken, ctx), ErrorCode.InvalidRefreshToken, HttpStatus.UNAUTHORIZED);
    });

    it('rejects when a concurrent rotation already happened (affected 0)', async () => {
      const s = setup();
      const { refreshToken } = await loggedIn(s);
      s.model.update.mockResolvedValueOnce([0]);
      await expectAppError(s.service.rotate(refreshToken, ctx), ErrorCode.InvalidRefreshToken, HttpStatus.UNAUTHORIZED);
    });

    it('revokes and returns 403 for restricted users', async () => {
      const s = setup();
      const { stored, refreshToken } = await loggedIn(s);
      stored.user = fakeUser({ id: stored.userId, isBanned: true });
      await expectAppError(s.service.rotate(refreshToken, ctx), ErrorCode.AccountRestricted, HttpStatus.FORBIDDEN);
      expect(s.model.update).toHaveBeenCalledWith(
        expect.objectContaining({ revokedReason: SessionRevokeReason.AccountRestricted }),
        expect.anything(),
      );
    });
  });

  describe('logout', () => {
    it('revokes the session for the current token and is idempotent', async () => {
      const s = setup();
      const { stored, refreshToken } = await loggedIn(s);

      await expect(s.service.revokeByRefreshToken(refreshToken, ctx)).resolves.toBe(stored.userId);
      expect(s.model.update).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: expect.any(Date), revokedReason: SessionRevokeReason.Logout }),
        expect.objectContaining({ where: expect.objectContaining({ id: stored.id, revokedAt: null }) }),
      );

      stored.revokedAt = new Date();
      s.model.update.mockClear();
      await expect(s.service.revokeByRefreshToken(refreshToken, ctx)).resolves.toBeNull();
      expect(s.model.update).not.toHaveBeenCalled();
    });

    it('does not revoke when the secret does not match or token is malformed', async () => {
      const s = setup();
      const { stored } = await loggedIn(s);
      const forged = s.tokens.buildRefreshToken(stored.id, s.tokens.generateRefreshSecret());
      await expect(s.service.revokeByRefreshToken(forged, ctx)).resolves.toBeNull();
      await expect(s.service.revokeByRefreshToken('garbage-garbage-garbage', ctx)).resolves.toBeNull();
      expect(s.model.update).not.toHaveBeenCalled();
    });

    it('revokeAllForUser revokes all active sessions and returns count', async () => {
      const s = setup();
      s.model.update.mockResolvedValue([3]);
      await expect(s.service.revokeAllForUser('u1', SessionRevokeReason.LogoutAll)).resolves.toBe(3);
      expect(s.model.update).toHaveBeenCalledWith(
        expect.objectContaining({ revokedReason: SessionRevokeReason.LogoutAll }),
        expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
      );
    });
  });
});
