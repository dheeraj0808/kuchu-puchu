import type { ProfilesService } from '../profiles/profiles.service';
import 'reflect-metadata';

import { HttpStatus } from '@nestjs/common';
import type { Sequelize } from 'sequelize-typescript';

import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import { SecurityEventType } from '../security/models/security-event.model';
import { UserResponseDto } from '../users/dto/user-response.dto';
import type { User } from '../users/models/user.model';
import type { UsersService } from '../users/users.service';
import { AuthService, OTP_REQUEST_MESSAGE } from './auth.service';
import { IdentifierType } from './models/otp-verification.model';
import type { OtpDeliveryService } from './services/otp-delivery.service';
import type { OtpService } from './services/otp.service';
import type { SessionService } from './services/session.service';
import type { TokenService } from './services/token.service';
import { fakeSecurityEvents, fakeSession, fakeUser } from './testing/fakes';

const ctx = { ipAddress: '192.0.2.1', userAgent: 'jest' };
const EMAIL = 'jane@example.com';

function setup() {
  const otp = {
    hashIdentifier: jest.fn().mockReturnValue('f'.repeat(64)),
    issue: jest.fn().mockResolvedValue({ otp: '123456', record: { id: 'r1' } }),
    verify: jest.fn(),
    linkUser: jest.fn().mockResolvedValue(undefined),
    ttlSeconds: 300,
    resendCooldownSeconds: 60,
  };
  const delivery = { send: jest.fn().mockResolvedValue(undefined) };
  const sessions = {
    create: jest.fn(),
    rotate: jest.fn(),
    revokeByRefreshToken: jest.fn(),
    revokeAllForUser: jest.fn(),
  };
  const tokens = { signAccessToken: jest.fn().mockResolvedValue({ token: 'jwt', expiresInSeconds: 900 }) };
  const users = {
    findByIdentifier: jest.fn().mockResolvedValue(null),
    createVerified: jest.fn(),
    findById: jest.fn(),
    toResponse: (u: User) => UserResponseDto.fromModel(u),
  };
  const events = fakeSecurityEvents();
  const profiles = { getOwnOrNull: jest.fn().mockResolvedValue(null) };
  const sequelize = { transaction: jest.fn((fn: (t: object) => Promise<unknown>) => fn({})) };
  const service = new AuthService(
    otp as unknown as OtpService,
    delivery as unknown as OtpDeliveryService,
    sessions as unknown as SessionService,
    tokens as unknown as TokenService,
    users as unknown as UsersService,
    events,
    sequelize as unknown as Sequelize,
    profiles as unknown as ProfilesService,
  );
  return { service, otp, delivery, sessions, tokens, users, events };
}

const eventTypes = (events: { record: jest.Mock }): unknown[] =>
  events.record.mock.calls.map((c: [{ eventType: SecurityEventType }]) => c[0].eventType);

describe('AuthService', () => {
  describe('requestOtp', () => {
    it('returns an identical generic response for known, unknown and banned users', async () => {
      const unknown = setup();
      const r1 = await unknown.service.requestOtp({ identifierType: IdentifierType.Email, identifier: EMAIL }, ctx);

      const known = setup();
      known.users.findByIdentifier.mockResolvedValue(fakeUser());
      const r2 = await known.service.requestOtp({ identifierType: IdentifierType.Email, identifier: EMAIL }, ctx);

      const banned = setup();
      banned.users.findByIdentifier.mockResolvedValue(fakeUser({ isBanned: true }));
      const r3 = await banned.service.requestOtp({ identifierType: IdentifierType.Email, identifier: EMAIL }, ctx);

      expect(r1).toEqual({ message: OTP_REQUEST_MESSAGE, expiresInSeconds: 300, resendAfterSeconds: 60 });
      expect(r2).toEqual(r1);
      expect(r3).toEqual(r1);
      expect(banned.delivery.send).not.toHaveBeenCalled();
      expect(banned.otp.issue).not.toHaveBeenCalled();
      expect(eventTypes(banned.events)).toContain(SecurityEventType.LoginBlocked);
      expect(unknown.delivery.send).toHaveBeenCalledWith(IdentifierType.Email, EMAIL, '123456');
    });

    it('never records the raw identifier or OTP in security events', async () => {
      const s = setup();
      await s.service.requestOtp({ identifierType: IdentifierType.Email, identifier: EMAIL }, ctx);
      const serialized = JSON.stringify(s.events.record.mock.calls);
      expect(serialized).not.toContain(EMAIL);
      expect(serialized).not.toContain('123456');
    });

    it('records throttling and rethrows cooldown', async () => {
      const s = setup();
      s.otp.issue.mockRejectedValue(
        new AppException(ErrorCode.OtpCooldown, { retryAfterSeconds: 30 }),
      );
      await expect(
        s.service.requestOtp({ identifierType: IdentifierType.Email, identifier: EMAIL }, ctx),
      ).rejects.toMatchObject({ code: ErrorCode.OtpCooldown });
      expect(eventTypes(s.events)).toContain(SecurityEventType.OtpRequestThrottled);
    });

    it('maps delivery failure to 503', async () => {
      const s = setup();
      s.delivery.send.mockRejectedValue(new Error('provider down'));
      const err = await s.service
        .requestOtp({ identifierType: IdentifierType.Email, identifier: EMAIL }, ctx)
        .catch((e: unknown) => e);
      expect((err as AppException).code).toBe(ErrorCode.OtpDeliveryFailed);
      expect((err as AppException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });

  describe('verifyOtp', () => {
    const dto = { identifierType: IdentifierType.Email, identifier: EMAIL, otp: '123456' };

    it.each(['not_found', 'mismatch', 'attempts_exceeded'] as const)(
      'returns the same 401 for reason %s',
      async (reason) => {
        const s = setup();
        s.otp.verify.mockResolvedValue({ ok: false, reason });
        const err = await s.service.verifyOtp(dto, ctx).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AppException);
        expect((err as AppException).code).toBe(ErrorCode.OtpInvalid);
        expect((err as AppException).message).toBe('Invalid or expired verification code');
        expect((err as AppException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
        expect(s.sessions.create).not.toHaveBeenCalled();
      },
    );

    it('registers a new user and issues tokens', async () => {
      const s = setup();
      const user = fakeUser();
      const session = fakeSession({ userId: user.id });
      s.otp.verify.mockResolvedValue({ ok: true, record: { id: 'r1' } });
      s.users.createVerified.mockResolvedValue(user);
      s.sessions.create.mockResolvedValue({ session, refreshToken: 'rt' });

      const res = await s.service.verifyOtp(dto, ctx);

      expect(res).toMatchObject({ accessToken: 'jwt', refreshToken: 'rt', tokenType: 'Bearer', accessTokenExpiresIn: 900 });
      expect(res.user.id).toBe(user.id);
      expect(s.otp.linkUser).toHaveBeenCalledWith('r1', user.id, expect.anything());
      expect(eventTypes(s.events)).toEqual(
        expect.arrayContaining([SecurityEventType.UserRegistered, SecurityEventType.LoginSucceeded]),
      );
    });

    it('blocks restricted accounts with 403 and no session', async () => {
      const s = setup();
      s.otp.verify.mockResolvedValue({ ok: true, record: { id: 'r1' } });
      s.users.findByIdentifier.mockResolvedValue(fakeUser({ isActive: false }));
      await expect(s.service.verifyOtp(dto, ctx)).rejects.toMatchObject({ code: ErrorCode.AccountRestricted });
      expect(s.sessions.create).not.toHaveBeenCalled();
    });
  });

  it('logout is idempotent and generic', async () => {
    const s = setup();
    s.sessions.revokeByRefreshToken.mockResolvedValueOnce('u1').mockResolvedValueOnce(null);
    await expect(s.service.logout({ refreshToken: 'x'.repeat(30) }, ctx)).resolves.toEqual({ message: 'Logged out' });
    await expect(s.service.logout({ refreshToken: 'x'.repeat(30) }, ctx)).resolves.toEqual({ message: 'Logged out' });
  });

  it('logoutAll revokes all sessions and records count', async () => {
    const s = setup();
    s.sessions.revokeAllForUser.mockResolvedValue(4);
    await s.service.logoutAll({ userId: 'u1', sessionId: 's1', role: fakeUser().role }, ctx);
    expect(s.sessions.revokeAllForUser).toHaveBeenCalledWith('u1', 'logout_all');
    expect(s.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: SecurityEventType.LogoutAll, metadata: { revokedSessions: 4 } }),
    );
  });
});
