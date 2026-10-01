import 'reflect-metadata';

import { HttpStatus } from '@nestjs/common';
import type { Sequelize } from 'sequelize-typescript';

import type { BanHashesService } from '../bans/ban-hashes.service';
import type { OnboardingService } from '../common/onboarding/onboarding.service';
import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import type { OutboxService } from '../events/outbox.service';
import type { ProfilesService } from '../profiles/profiles.service';
import { SecurityEventType } from '../security/models/security-event.model';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { type User, UserStatus } from '../users/models/user.model';
import { IdentifierUnavailableError, type UsersService } from '../users/users.service';
import { AuthService, OTP_REQUEST_MESSAGE } from './auth.service';
import { OtpChannel } from './models/otp-verification.model';
import type { OtpDeliveryService } from './services/otp-delivery.service';
import type { OtpService } from './services/otp.service';
import type { SessionService } from './services/session.service';
import type { TokenService } from './services/token.service';
import { fakeSecurityEvents, fakeSession, fakeUser } from './testing/fakes';

const ctx = { ipAddress: '192.0.2.1', userAgent: 'jest' };
const EMAIL = 'jane@example.com';
const PHONE = '+919812345678';
const device = { deviceId: 'dev-1', deviceName: 'Pixel', platform: 'android' as const, appVersion: '1.0.0' };

function setup() {
  const otp = {
    hashIdentifier: jest.fn((t: string, v: string) => `H(${t}:${v})`),
    rateLimitHash: jest.fn((t: string, v: string) => `R(${t}:${v})`),
    issue: jest.fn().mockResolvedValue({ otp: '123456', record: { id: 'r1' }, release: jest.fn() }),
    verify: jest.fn(),
    ttlSeconds: 300,
    resendCooldownSeconds: 60,
  };
  const delivery = { send: jest.fn().mockResolvedValue({ status: 'sent', pool: 'new' }) };
  const sessions = {
    create: jest.fn(),
    rotate: jest.fn(),
    revokeByRefreshToken: jest.fn(),
    revokeAllForUser: jest.fn(),
    revokeOwn: jest.fn(),
    markReauthenticated: jest.fn().mockResolvedValue(true),
  };
  const tokens = { signAccessToken: jest.fn().mockResolvedValue({ token: 'jwt', expiresInSeconds: 900 }) };
  const users = {
    findByIdentifier: jest.fn().mockResolvedValue(null),
    findByIdForUpdate: jest.fn(),
    createVerified: jest.fn(),
    findById: jest.fn(),
    toResponse: (u: User) => UserResponseDto.fromModel(u),
  };
  const events = fakeSecurityEvents();
  const outbox = { publish: jest.fn().mockResolvedValue('1') };
  const onboarding = { nextStep: jest.fn().mockResolvedValue('selfie') };
  const profiles = { getOwnOrNull: jest.fn().mockResolvedValue(null) };
  const tx = { id: 'tx' };
  const sequelize = { transaction: jest.fn((fn: (t: object) => Promise<unknown>) => fn(tx)) };
  const bans = { isIdentifierBanned: jest.fn().mockResolvedValue(false) };
  const service = new AuthService(
    otp as unknown as OtpService,
    delivery as unknown as OtpDeliveryService,
    sessions as unknown as SessionService,
    tokens as unknown as TokenService,
    users as unknown as UsersService,
    events,
    outbox as unknown as OutboxService,
    onboarding as unknown as OnboardingService,
    profiles as unknown as ProfilesService,
    sequelize as unknown as Sequelize,
    bans as unknown as BanHashesService,
  );
  return { service, otp, delivery, sessions, tokens, users, events, outbox, onboarding, tx, bans };
}

const eventTypes = (events: { record: jest.Mock }): string[] =>
  events.record.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);

describe('AuthService', () => {
  describe('requestOtp', () => {
    it('one code is issued and delivered for any identifier, same body; the lookup only picks the SMS pool', async () => {
      const s = setup();
      const res = await s.service.requestOtp({ channel: OtpChannel.Sms, identifier: PHONE }, { ...ctx, deviceId: 'dev-9' });
      expect(res).toEqual({ message: OTP_REQUEST_MESSAGE, expiresInSeconds: 300, resendAfterSeconds: 60 });
      expect(s.otp.issue).toHaveBeenCalledWith({
        identifierHash: `H(phone:${PHONE})`,
        rateLimitHash: `R(phone:${PHONE})`,
        channel: 'sms',
        purpose: 'login',
        requestIp: '192.0.2.1',
        deviceId: 'dev-9',
      });
      expect(s.delivery.send).toHaveBeenCalledWith({ type: 'phone', identifier: PHONE, otp: '123456', purpose: 'login', existingAccount: false });
      expect(eventTypes(s.events)).toEqual([SecurityEventType.OtpRequested]);

      s.users.findByIdentifier.mockResolvedValue(fakeUser({ phone: PHONE }));
      await expect(s.service.requestOtp({ channel: OtpChannel.Sms, identifier: PHONE }, ctx)).resolves.toEqual(res);
      expect(s.delivery.send).toHaveBeenLastCalledWith(expect.objectContaining({ existingAccount: true }));
    });

    it.each([
      [OtpChannel.Sms, { status: 'country_blocked' }, SecurityEventType.OtpSmsCountryBlocked],
      [OtpChannel.Sms, { status: 'budget_blocked', pool: 'new' }, SecurityEventType.OtpSmsBudgetBlocked],
      [OtpChannel.Email, { status: 'budget_blocked' }, SecurityEventType.OtpEmailBudgetBlocked],
    ])('%s fraud guard %j → the same 200 and a security event', async (channel, outcome, eventType) => {
      const s = setup();
      s.delivery.send.mockResolvedValue(outcome);
      const identifier = channel === OtpChannel.Sms ? PHONE : EMAIL;
      await expect(s.service.requestOtp({ channel, identifier }, ctx)).resolves.toEqual({
        message: OTP_REQUEST_MESSAGE,
        expiresInSeconds: 300,
        resendAfterSeconds: 60,
      });
      expect(eventTypes(s.events)).toEqual([eventType]);
    });

    it('identifiers reach audit metadata only as the hash prefix', async () => {
      const s = setup();
      await s.service.requestOtp({ channel: OtpChannel.Email, identifier: EMAIL }, ctx);
      expect(JSON.stringify(s.events.record.mock.calls)).not.toContain(EMAIL);
    });

    it('delivery failure → 503 OTP_DELIVERY_FAILED and the cooldown and cap slots are released', async () => {
      const s = setup();
      const release = jest.fn();
      s.otp.issue.mockResolvedValue({ otp: '1', record: {}, release });
      s.delivery.send.mockRejectedValue(new Error('provider down'));
      const err = (await s.service.requestOtp({ channel: OtpChannel.Email, identifier: EMAIL }, ctx).catch((e: unknown) => e)) as AppException;
      expect(err.code).toBe(ErrorCode.OtpDeliveryFailed);
      expect(release).toHaveBeenCalled();
    });

    it('429 from issuance is audited and passed through', async () => {
      const s = setup();
      s.otp.issue.mockRejectedValue(new AppException(ErrorCode.OtpCooldown, { retryAfterSeconds: 30 }));
      await expect(s.service.requestOtp({ channel: OtpChannel.Email, identifier: EMAIL }, ctx)).rejects.toMatchObject({
        code: ErrorCode.OtpCooldown,
      });
      expect(eventTypes(s.events)).toEqual([SecurityEventType.OtpRequestThrottled]);
    });
  });

  describe('verifyOtp', () => {
    const dto = { channel: OtpChannel.Email, identifier: EMAIL, otp: '123456', ...device };

    it.each(['not_found', 'mismatch', 'attempts_exceeded'] as const)('returns the same 401 OTP_INVALID for %s', async (reason) => {
      const s = setup();
      s.otp.verify.mockResolvedValue({ ok: false, reason });
      const err = (await s.service.verifyOtp(dto, ctx).catch((e: unknown) => e)) as AppException;
      expect(err.code).toBe(ErrorCode.OtpInvalid);
      expect(err.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
      expect(err.message).toBe('Invalid or expired verification code');
      expect(s.sessions.create).not.toHaveBeenCalled();
    });

    it('registers: user.registered in the transaction, no new-device event, isNewUser + nextStep', async () => {
      const s = setup();
      const user = fakeUser();
      const session = fakeSession({ userId: user.id });
      s.otp.verify.mockResolvedValue({ ok: true, record: { id: 'r1', channel: 'email' } });
      s.users.createVerified.mockResolvedValue({ user, created: true });
      s.sessions.create.mockResolvedValue({ session, refreshToken: 'rt', newDevice: true, replacedSessionIds: [], evictedSessionIds: [] });

      const res = await s.service.verifyOtp(dto, ctx);

      expect(res).toEqual({
        accessToken: 'jwt',
        refreshToken: 'rt',
        expiresIn: 900,
        user: UserResponseDto.fromModel(user),
        isNewUser: true,
        nextStep: 'selfie',
      });
      expect(s.otp.verify).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'login', channel: 'email' }));
      expect(s.outbox.publish).toHaveBeenCalledWith('user.registered', user.id, { userId: user.id }, s.tx);
      expect(s.outbox.publish).not.toHaveBeenCalledWith('auth.new_device', expect.anything(), expect.anything(), expect.anything());
      expect(s.tokens.signAccessToken).toHaveBeenCalledWith({ sub: user.id, sid: session.id });
    });

    it('existing user on an unseen device: locked row, auth.new_device published, security event', async () => {
      const s = setup();
      const user = fakeUser();
      const session = fakeSession({ userId: user.id });
      s.otp.verify.mockResolvedValue({ ok: true, record: { id: 'r1' } });
      s.users.findByIdentifier.mockResolvedValue(user);
      s.users.findByIdForUpdate.mockResolvedValue(user);
      s.sessions.create.mockResolvedValue({ session, refreshToken: 'rt', newDevice: true, replacedSessionIds: ['old'], evictedSessionIds: [] });

      const res = await s.service.verifyOtp(dto, ctx);

      expect(res.isNewUser).toBe(false);
      expect(s.users.findByIdForUpdate).toHaveBeenCalledWith(user.id, s.tx);
      expect(s.outbox.publish).toHaveBeenCalledWith('auth.new_device', user.id, { userId: user.id, sessionId: session.id }, s.tx);
      expect(eventTypes(s.events)).toEqual(
        expect.arrayContaining([SecurityEventType.NewDevice, SecurityEventType.SessionRevoked, SecurityEventType.LoginSucceeded]),
      );
    });

    it('a NEW account for an identifier in ban_hashes (canonical form) → 403 ACCOUNT_RESTRICTED; no user, no session', async () => {
      const s = setup();
      s.otp.verify.mockResolvedValue({ ok: true, record: { id: 'r1' } });
      s.bans.isIdentifierBanned.mockResolvedValue(true);
      await expect(s.service.verifyOtp(dto, ctx)).rejects.toMatchObject({ code: ErrorCode.AccountRestricted });
      expect(s.bans.isIdentifierBanned).toHaveBeenCalledWith('email', EMAIL, s.tx);
      expect(s.users.createVerified).not.toHaveBeenCalled();
      expect(s.sessions.create).not.toHaveBeenCalled();
      const blocked = s.events.record.mock.calls.map((c) => c[0] as { eventType: string; userId: unknown; metadata: Record<string, unknown> });
      expect(blocked.find((e) => e.eventType === SecurityEventType.LoginBlocked)).toMatchObject({
        userId: null,
        metadata: { reason: 'ban_hash', stage: 'verify_otp' },
      });
    });

    it.each([UserStatus.Banned, UserStatus.Suspended])('%s user with the correct code → 403 ACCOUNT_RESTRICTED, no session', async (status) => {
      const s = setup();
      const user = fakeUser({ status });
      s.otp.verify.mockResolvedValue({ ok: true, record: { id: 'r1' } });
      s.users.findByIdentifier.mockResolvedValue(user);
      s.users.findByIdForUpdate.mockResolvedValue(user);
      await expect(s.service.verifyOtp(dto, ctx)).rejects.toMatchObject({ code: ErrorCode.AccountRestricted });
      expect(s.sessions.create).not.toHaveBeenCalled();
      expect(s.tokens.signAccessToken).not.toHaveBeenCalled();
    });

    it('an identifier held by a deleted account → the same 401 OTP_INVALID (not a 500)', async () => {
      const s = setup();
      s.otp.verify.mockResolvedValue({ ok: true, record: { id: 'r1' } });
      s.users.createVerified.mockRejectedValue(new IdentifierUnavailableError());
      await expect(s.service.verifyOtp(dto, ctx)).rejects.toMatchObject({ code: ErrorCode.OtpInvalid });
      expect(s.sessions.create).not.toHaveBeenCalled();
    });
  });

  it('refresh returns only the new pair', async () => {
    const s = setup();
    const user = fakeUser();
    s.sessions.rotate.mockResolvedValue({ session: fakeSession({ userId: user.id }), user, refreshToken: 'rt2' });
    await expect(s.service.refresh({ refreshToken: 'x' }, ctx)).resolves.toEqual({ accessToken: 'jwt', refreshToken: 'rt2', expiresIn: 900 });
  });

  it('logout is always 200, known token or not', async () => {
    const s = setup();
    s.sessions.revokeByRefreshToken.mockResolvedValueOnce({ userId: 'u1', sessionId: 's1' }).mockResolvedValueOnce(null);
    await expect(s.service.logout({ refreshToken: 'x'.repeat(30) }, ctx)).resolves.toEqual({ message: 'Logged out' });
    await expect(s.service.logout({ refreshToken: 'x'.repeat(30) }, ctx)).resolves.toEqual({ message: 'Logged out' });
    expect(eventTypes(s.events)).toEqual([SecurityEventType.Logout]);
  });

  it('logoutAll revokes every session including the current one', async () => {
    const s = setup();
    s.sessions.revokeAllForUser.mockResolvedValue(4);
    await s.service.logoutAll({ userId: 'u1', sessionId: 's1', role: fakeUser().role }, ctx);
    expect(s.sessions.revokeAllForUser).toHaveBeenCalledWith('u1', 'logout_all');
  });

  it("revokeSession: 404 NOT_FOUND unless it is one of the caller's live sessions", async () => {
    const s = setup();
    s.sessions.revokeOwn.mockResolvedValue(false);
    await expect(s.service.revokeSession({ userId: 'u1', sessionId: 's1', role: fakeUser().role }, 's2', ctx)).rejects.toMatchObject({
      code: ErrorCode.NotFound,
    });
  });

  describe('step-up', () => {
    const principal = (user: User) => ({ userId: user.id, sessionId: 's1', role: user.role });

    it('reauth/request defaults to the verified phone, else email; an unverified channel → 400', async () => {
      const s = setup();
      const both = fakeUser({ phone: PHONE, phoneVerifiedAt: new Date(), email: EMAIL, emailVerifiedAt: new Date() });
      s.users.findById.mockResolvedValue(both);
      await expect(s.service.reauthRequest(principal(both), {}, ctx)).resolves.toMatchObject({ channel: 'sms' });
      expect(s.otp.issue).toHaveBeenLastCalledWith(expect.objectContaining({ purpose: 'reauth', identifierHash: `H(phone:${PHONE})` }));
      // Step-up is always for an account: its SMS comes from the reserve.
      expect(s.delivery.send).toHaveBeenLastCalledWith(expect.objectContaining({ purpose: 'reauth', existingAccount: true }));

      const emailOnly = fakeUser({ phone: null, phoneVerifiedAt: null });
      s.users.findById.mockResolvedValue(emailOnly);
      await expect(s.service.reauthRequest(principal(emailOnly), {}, ctx)).resolves.toMatchObject({ channel: 'email' });
      await expect(s.service.reauthRequest(principal(emailOnly), { channel: OtpChannel.Sms }, ctx)).rejects.toMatchObject({
        code: ErrorCode.ValidationError,
      });
    });

    it('reauth/verify checks a purpose=reauth code against the account identifiers and marks the session', async () => {
      const s = setup();
      const user = fakeUser({ phone: PHONE, phoneVerifiedAt: new Date() });
      s.users.findById.mockResolvedValue(user);
      s.otp.verify.mockResolvedValue({ ok: true, record: { channel: 'sms' } });
      const res = await s.service.reauthVerify(principal(user), { otp: '123456' }, ctx);
      expect(res.validForSeconds).toBe(600);
      expect(s.otp.verify).toHaveBeenCalledWith({
        identifierHashes: [`H(phone:${PHONE})`, `H(email:${EMAIL})`],
        purpose: 'reauth',
        otp: '123456',
      });
      expect(s.sessions.markReauthenticated).toHaveBeenCalledWith(user.id, 's1', expect.any(Date));
      expect(eventTypes(s.events)).toEqual([SecurityEventType.ReauthSucceeded]);
    });

    it('reauth/verify failure → 401 OTP_INVALID and auth.reauth_failed', async () => {
      const s = setup();
      const user = fakeUser();
      s.users.findById.mockResolvedValue(user);
      s.otp.verify.mockResolvedValue({ ok: false, reason: 'mismatch' });
      await expect(s.service.reauthVerify(principal(user), { otp: '000000' }, ctx)).rejects.toMatchObject({ code: ErrorCode.OtpInvalid });
      expect(s.sessions.markReauthenticated).not.toHaveBeenCalled();
      expect(eventTypes(s.events)).toEqual([SecurityEventType.ReauthFailed]);
    });
  });
});
