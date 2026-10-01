import 'reflect-metadata';

import { HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AppException, ErrorCode } from '../../common/exceptions/app.exception';
import { SecurityEventType } from '../../security/models/security-event.model';
import { UserStatus } from '../../users/models/user.model';
import type { Session } from '../models/session.model';
import { createTestConfig } from '../testing/test-config';
import { fakeSecurityEvents, fakeSession, fakeUser } from '../testing/fakes';
import { REAUTH_WINDOW_MS, SessionRevokeReason, SessionService } from './session.service';
import { TokenService } from './token.service';

const ctx = { ipAddress: '198.51.100.7', userAgent: 'jest', appVersion: '1.2.0' };
const device = { deviceId: 'dev-1', deviceName: 'Pixel', platform: 'android' as const, appVersion: '1.0.0' };
const DAY = 86_400_000;

function setup() {
  const tokens = new TokenService(new JwtService(), createTestConfig());
  const model = {
    findByPk: jest.fn().mockResolvedValue(null),
    findOne: jest.fn().mockResolvedValue(null),
    findAll: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue([1]),
    create: jest.fn((attrs: Record<string, unknown>) => Promise.resolve(fakeSession(attrs as Partial<Session>))),
  };
  const tx = { id: 'tx' };
  const sequelize = { transaction: jest.fn((fn: (t: object) => Promise<unknown>) => fn(tx)) };
  const events = fakeSecurityEvents();
  const sessionState = { invalidate: jest.fn().mockResolvedValue(undefined), invalidateUser: jest.fn().mockResolvedValue(undefined) };
  const outbox = { publish: jest.fn().mockResolvedValue('1') };
  const service = new SessionService(
    model as unknown as typeof Session,
    sequelize as never,
    tokens,
    events,
    sessionState as never,
    outbox as never,
  );
  return { service, model, tokens, events, sessionState, outbox, tx };
}

/** A stored session with a known refresh token. */
function stored(s: ReturnType<typeof setup>, overrides: Partial<Session> = {}) {
  const secret = s.tokens.generateRefreshSecret();
  const user = fakeUser();
  const session = fakeSession({ userId: user.id, user, refreshTokenHash: s.tokens.hashRefreshSecret(secret), ...overrides });
  s.model.findByPk.mockResolvedValue(session);
  return { session, user, secret, refreshToken: s.tokens.buildRefreshToken(session.id, secret) };
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
  describe('create', () => {
    it('stores only the HMAC; the token is "<sessionId>.<64-char secret>"; 30 d sliding, 90 d absolute', async () => {
      const s = setup();
      const { session, refreshToken, newDevice } = await s.service.create('u1', device, ctx, s.tx as never);
      const parsed = s.tokens.parseRefreshToken(refreshToken);
      expect(parsed?.sessionId).toBe(session.id);
      expect(parsed?.secret).toHaveLength(64);
      const attrs = s.model.create.mock.calls[0][0] as Record<string, unknown>;
      expect(attrs.refreshTokenHash).toBe(s.tokens.hashRefreshSecret(parsed!.secret));
      expect(JSON.stringify(attrs)).not.toContain(parsed!.secret);
      expect(attrs).toMatchObject({ deviceId: 'dev-1', deviceName: 'Pixel', platform: 'android', appVersion: '1.0.0' });
      const sliding = (attrs.expiresAt as Date).getTime() - Date.now();
      const absolute = (attrs.absoluteExpiresAt as Date).getTime() - Date.now();
      expect(Math.round(sliding / DAY)).toBe(30);
      expect(Math.round(absolute / DAY)).toBe(90);
      expect(newDevice).toBe(true);
    });

    it('a live session on the same device is revoked as "replaced"; a known device is not new', async () => {
      const s = setup();
      s.model.findAll.mockResolvedValue([
        { id: 'old-live', revokedAt: null },
        { id: 'old-revoked', revokedAt: new Date() },
      ]);
      const { newDevice, replacedSessionIds } = await s.service.create('u1', device, ctx, s.tx as never);
      expect(replacedSessionIds).toEqual(['old-live']);
      expect(newDevice).toBe(false);
      expect(s.model.update.mock.calls[0][0]).toMatchObject({ revokedReason: SessionRevokeReason.Replaced });
      expect(s.sessionState.invalidate).toHaveBeenCalledWith(['old-live'], s.tx);
    });
  });

  describe('rotate', () => {
    it('rotates: new secret, current hash moves to previous_token_hash, conditional update, cache dropped', async () => {
      const s = setup();
      const { session, refreshToken } = stored(s);
      const oldHash = session.refreshTokenHash;
      const result = await s.service.rotate(refreshToken, ctx);
      expect(result.refreshToken).not.toBe(refreshToken);
      const [changes, opts] = s.model.update.mock.calls[0] as [Record<string, unknown>, { where: Record<string, unknown> }];
      expect(changes.previousTokenHash).toBe(oldHash);
      expect(changes.refreshTokenHash).toBe(s.tokens.hashRefreshSecret(s.tokens.parseRefreshToken(result.refreshToken)!.secret));
      expect(opts.where).toEqual({ id: session.id, refreshTokenHash: oldHash, revokedAt: null });
      expect(changes.appVersion).toBe('1.2.0');
      expect(s.sessionState.invalidate).toHaveBeenCalledWith([session.id]);
    });

    it('sliding: expires_at = now + 30 d, but never past absolute_expires_at', async () => {
      const s = setup();
      const absolute = new Date(Date.now() + 10 * DAY);
      const { refreshToken } = stored(s, { absoluteExpiresAt: absolute, expiresAt: new Date(Date.now() + DAY) });
      await s.service.rotate(refreshToken, ctx);
      const changes = s.model.update.mock.calls[0][0] as { expiresAt: Date; absoluteExpiresAt?: Date };
      expect(changes.expiresAt.getTime()).toBe(absolute.getTime());
      expect(changes).not.toHaveProperty('absoluteExpiresAt');
    });

    it('the previous token → every session revoked (reuse_detected), auth.token_reuse, security event, 401 UNAUTHORIZED', async () => {
      const s = setup();
      const oldSecret = s.tokens.generateRefreshSecret();
      const { session } = stored(s, { previousTokenHash: s.tokens.hashRefreshSecret(oldSecret) });
      s.model.update.mockResolvedValue([3]);
      await expectAppError(
        s.service.rotate(s.tokens.buildRefreshToken(session.id, oldSecret), ctx),
        ErrorCode.Unauthorized,
        HttpStatus.UNAUTHORIZED,
      );
      expect(s.model.update).toHaveBeenCalledWith(
        expect.objectContaining({ revokedReason: SessionRevokeReason.ReuseDetected }),
        expect.objectContaining({ where: { userId: session.userId, revokedAt: null }, transaction: s.tx }),
      );
      expect(s.outbox.publish).toHaveBeenCalledWith('auth.token_reuse', session.userId, { userId: session.userId, sessionId: session.id }, s.tx);
      expect(s.events.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: SecurityEventType.RefreshTokenReuseDetected, transaction: s.tx }),
      );
      expect(s.sessionState.invalidateUser).toHaveBeenCalledWith(session.userId, s.tx);
    });

    it('losing a rotation race (conditional update hits 0 rows, session still open) is reuse too', async () => {
      const s = setup();
      const { session, refreshToken } = stored(s);
      s.model.update.mockResolvedValueOnce([0]).mockResolvedValue([2]);
      s.model.findByPk.mockResolvedValueOnce(session).mockResolvedValueOnce({ id: session.id, userId: session.userId, revokedAt: null });
      await expectAppError(s.service.rotate(refreshToken, ctx), ErrorCode.Unauthorized, HttpStatus.UNAUTHORIZED);
      expect(s.outbox.publish).toHaveBeenCalledWith('auth.token_reuse', session.userId, expect.anything(), s.tx);
    });

    it('a replay after everything is already revoked publishes nothing new', async () => {
      const s = setup();
      const oldSecret = s.tokens.generateRefreshSecret();
      const { session } = stored(s, { previousTokenHash: s.tokens.hashRefreshSecret(oldSecret) });
      s.model.update.mockResolvedValue([0]);
      await expectAppError(s.service.rotate(s.tokens.buildRefreshToken(session.id, oldSecret), ctx), ErrorCode.Unauthorized, 401);
      expect(s.outbox.publish).not.toHaveBeenCalled();
    });

    it.each([
      ['malformed', () => 'nope'],
      ['unknown session', () => `${'0'.repeat(8)}-0000-7000-8000-${'0'.repeat(12)}.${'a'.repeat(64)}`],
    ])('%s → 401 UNAUTHORIZED, no reuse handling', async (_n, token) => {
      const s = setup();
      await expectAppError(s.service.rotate(token(), ctx), ErrorCode.Unauthorized, HttpStatus.UNAUTHORIZED);
      expect(s.outbox.publish).not.toHaveBeenCalled();
    });

    it('revoked, sliding-expired or absolute-expired sessions → 401 without reuse handling', async () => {
      for (const overrides of [
        { revokedAt: new Date() },
        { expiresAt: new Date(Date.now() - 1) },
        { absoluteExpiresAt: new Date(Date.now() - 1) },
      ]) {
        const s = setup();
        const { refreshToken } = stored(s, overrides);
        await expectAppError(s.service.rotate(refreshToken, ctx), ErrorCode.Unauthorized, HttpStatus.UNAUTHORIZED);
        expect(s.outbox.publish).not.toHaveBeenCalled();
      }
    });

    it('a foreign secret for a real session id → 401 (not reuse)', async () => {
      const s = setup();
      const { session } = stored(s);
      await expectAppError(
        s.service.rotate(s.tokens.buildRefreshToken(session.id, s.tokens.generateRefreshSecret()), ctx),
        ErrorCode.Unauthorized,
        401,
      );
      expect(s.outbox.publish).not.toHaveBeenCalled();
    });

    it('restricted user → session revoked (restricted), 403 ACCOUNT_RESTRICTED', async () => {
      const s = setup();
      const user = fakeUser({ status: UserStatus.Banned });
      const { refreshToken, session } = stored(s, { user, userId: user.id });
      await expectAppError(s.service.rotate(refreshToken, ctx), ErrorCode.AccountRestricted, HttpStatus.FORBIDDEN);
      expect(s.model.update).toHaveBeenCalledWith(
        expect.objectContaining({ revokedReason: SessionRevokeReason.Restricted }),
        expect.objectContaining({ where: { id: session.id, revokedAt: null } }),
      );
    });
  });

  it('revokeByRefreshToken only revokes with the current token; drops the cache', async () => {
    const s = setup();
    const { session, refreshToken } = stored(s);
    await expect(s.service.revokeByRefreshToken(refreshToken)).resolves.toEqual({ userId: session.userId, sessionId: session.id });
    expect(s.sessionState.invalidate).toHaveBeenCalledWith([session.id]);
    await expect(s.service.revokeByRefreshToken(s.tokens.buildRefreshToken(session.id, s.tokens.generateRefreshSecret()))).resolves.toBeNull();
    await expect(s.service.revokeByRefreshToken('garbage')).resolves.toBeNull();
  });

  it('revokeOwn is scoped to the caller and to live sessions', async () => {
    const s = setup();
    s.model.update.mockResolvedValueOnce([0]);
    await expect(s.service.revokeOwn('u1', 's1')).resolves.toBe(false);
    expect(s.model.update.mock.calls[0][1].where).toMatchObject({ id: 's1', userId: 'u1', revokedAt: null });
    expect(s.sessionState.invalidate).not.toHaveBeenCalled();
    await expect(s.service.revokeOwn('u1', 's1')).resolves.toBe(true);
    expect(s.sessionState.invalidate).toHaveBeenCalledWith(['s1']);
  });

  it('hasFreshReauth: within 10 minutes only', async () => {
    const s = setup();
    const now = new Date();
    s.model.findOne.mockResolvedValueOnce({ reauthenticatedAt: new Date(now.getTime() - REAUTH_WINDOW_MS + 1000) });
    await expect(s.service.hasFreshReauth('u1', 's1', now)).resolves.toBe(true);
    s.model.findOne.mockResolvedValueOnce({ reauthenticatedAt: new Date(now.getTime() - REAUTH_WINDOW_MS - 1000) });
    await expect(s.service.hasFreshReauth('u1', 's1', now)).resolves.toBe(false);
    s.model.findOne.mockResolvedValueOnce({ reauthenticatedAt: null });
    await expect(s.service.hasFreshReauth('u1', 's1', now)).resolves.toBe(false);
    s.model.findOne.mockResolvedValueOnce(null);
    await expect(s.service.hasFreshReauth('u1', 's1', now)).resolves.toBe(false);
  });
});
