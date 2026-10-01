import 'reflect-metadata';

import { createHmac } from 'node:crypto';

import { HttpStatus } from '@nestjs/common';

import { AppException, ErrorCode } from '../../common/exceptions/app.exception';
import { IdentifierType, OtpChannel, OtpPurpose, type OtpVerification } from '../models/otp-verification.model';
import { fakeWindowRedis, type FakeWindowRedis } from '../../infra/redis/testing/fake-window-redis';
import { createTestConfig, TEST_OTP_CONFIG } from '../testing/test-config';
import { otpCooldownKey, otpDeviceKey, otpHourlyKey, otpIpKey, OtpService } from './otp.service';

type ModelMock = {
  findOne: jest.Mock;
  count: jest.Mock;
  min: jest.Mock;
  update: jest.Mock;
  create: jest.Mock;
};

const EMAIL = 'jane@example.com';

function setup(): { service: OtpService; model: ModelMock; redis: FakeWindowRedis } {
  const model: ModelMock = {
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    min: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue([1]),
    create: jest.fn((attrs: Record<string, unknown>) => Promise.resolve({ id: 'rec-1', ...attrs })),
  };
  const redis = fakeWindowRedis();
  const service = new OtpService(model as unknown as typeof OtpVerification, redis as never, createTestConfig());
  return { service, model, redis };
}

function hashOf(service: OtpService): string {
  return service.hashIdentifier(IdentifierType.Email, EMAIL);
}

function issueInput(service: OtpService, overrides: { email?: string; purpose?: OtpPurpose; deviceId?: string; requestIp?: string } = {}) {
  const email = overrides.email ?? EMAIL;
  return {
    identifierHash: service.hashIdentifier(IdentifierType.Email, email),
    rateLimitHash: service.rateLimitHash(IdentifierType.Email, email),
    channel: OtpChannel.Email,
    purpose: overrides.purpose ?? OtpPurpose.Login,
    requestIp: overrides.requestIp ?? '203.0.113.5',
    deviceId: 'deviceId' in overrides ? overrides.deviceId : 'device-1',
  };
}

const rejection = async (p: Promise<unknown>): Promise<AppException> => (await p.catch((e: unknown) => e)) as AppException;

function record(service: OtpService, otp: string, overrides: Partial<OtpVerification> = {}): OtpVerification {
  const identifierHash = hashOf(service);
  return {
    id: 'rec-1',
    identifierHash,
    channel: OtpChannel.Email,
    purpose: OtpPurpose.Login,
    otpHash: service.hashOtp(identifierHash, otp),
    attempts: 0,
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ...overrides,
  } as OtpVerification;
}

const verifyInput = (service: OtpService, otp: string) => ({
  identifierHashes: [hashOf(service)],
  purpose: OtpPurpose.Login,
  channel: OtpChannel.Email,
  otp,
});

describe('OtpService', () => {
  it('hashes the identifier as HMAC-SHA256(secret, "type:normalised")', () => {
    const { service } = setup();
    const expected = createHmac('sha256', TEST_OTP_CONFIG.hashSecret).update(`email:${EMAIL}`).digest('hex');
    expect(service.hashIdentifier(IdentifierType.Email, EMAIL)).toBe(expected);
  });

  it('rateLimitHash: +tag and Gmail-dot aliases share one hash; the stored identifierHash stays exact', () => {
    const { service } = setup();
    const canonical = service.rateLimitHash(IdentifierType.Email, 'janedoe@gmail.com');
    for (const alias of ['jane.doe@gmail.com', 'j.a.n.e.doe+dating@googlemail.com', 'janedoe+x@gmail.com']) {
      expect(service.rateLimitHash(IdentifierType.Email, alias)).toBe(canonical);
      expect(service.hashIdentifier(IdentifierType.Email, alias)).not.toBe(service.hashIdentifier(IdentifierType.Email, 'janedoe@gmail.com'));
    }
    expect(service.rateLimitHash(IdentifierType.Email, 'jane+work@example.com')).toBe(service.rateLimitHash(IdentifierType.Email, 'jane@example.com'));
    // Dots only matter for Gmail.
    expect(service.rateLimitHash(IdentifierType.Email, 'jane.doe@example.com')).not.toBe(service.rateLimitHash(IdentifierType.Email, 'janedoe@example.com'));
    // Without an alias both hashes are the same value.
    expect(service.rateLimitHash(IdentifierType.Email, EMAIL)).toBe(hashOf(service));
  });

  describe('issue', () => {
    afterEach(() => jest.useRealTimers());

    it('stores only hashes, with channel, purpose and request ip; returns the plaintext in memory', async () => {
      const { service, model } = setup();
      const { otp } = await service.issue(issueInput(service));
      expect(otp).toMatch(/^\d{6}$/);
      const attrs = model.create.mock.calls[0][0] as Record<string, unknown>;
      expect(attrs).toMatchObject({ channel: 'email', purpose: 'login', requestIp: '203.0.113.5', attempts: 0 });
      expect(attrs.otpHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(attrs)).not.toContain(EMAIL);
      expect(JSON.stringify(attrs)).not.toContain(`"${otp}"`);
      const ttl = (attrs.expiresAt as Date).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(299_000);
      expect(ttl).toBeLessThanOrEqual(300_000);
    });

    it('takes the cooldown with one atomic SET NX EX 60 per canonical identifier and purpose', async () => {
      const { service, redis } = setup();
      await service.issue(issueInput(service));
      expect(redis.set).toHaveBeenCalledWith(otpCooldownKey(OtpPurpose.Login, hashOf(service)), '1', 'EX', 60, 'NX');
    });

    it('cooldown taken → 429 OTP_COOLDOWN with retryAfterSeconds from the key TTL; nothing written', async () => {
      const { service, model, redis } = setup();
      redis.set.mockResolvedValueOnce(null);
      redis.pttl.mockResolvedValueOnce(42_100);
      const err = await rejection(service.issue(issueInput(service)));
      expect(err.code).toBe(ErrorCode.OtpCooldown);
      expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(err.details).toEqual({ retryAfterSeconds: 43 });
      expect(model.create).not.toHaveBeenCalled();
    });

    it('an alias (+tag, Gmail dots) is in the cooldown of its canonical address', async () => {
      const { service } = setup();
      await service.issue(issueInput(service, { email: 'jane.doe@gmail.com' }));
      const err = await rejection(service.issue(issueInput(service, { email: 'janedoe+2@googlemail.com', deviceId: 'device-2' })));
      expect(err.code).toBe(ErrorCode.OtpCooldown);
    });

    it('5 codes in the last hour for the canonical identifier → 429 TOO_MANY_REQUESTS until the oldest ages out', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-01T10:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
      const { service, redis } = setup();
      const aliases = ['jane@gmail.com', 'j.ane@gmail.com', 'jane+1@gmail.com', 'ja.ne+2@googlemail.com', 'jan.e@gmail.com'];
      for (const [i, email] of aliases.entries()) {
        await service.issue(issueInput(service, { email, deviceId: `d${i}` }));
        redis.strings.clear(); // the cooldown passing
        jest.setSystemTime(Date.now() + 10 * 60_000);
      }
      const err = await rejection(service.issue(issueInput(service, { email: 'jane@gmail.com', deviceId: 'd9' })));
      expect(err.code).toBe(ErrorCode.TooManyRequests);
      // The first code was 50 minutes ago: it ages out in 10 minutes.
      expect(err.details).toEqual({ retryAfterSeconds: 600 });
      // A refused request hands its cooldown back.
      expect(redis.strings.size).toBe(0);
    });

    it('20 codes in the last hour from one IP for the same purpose (OTP_MAX_PER_IP_PER_HOUR) → 429; slots taken are handed back', async () => {
      const { service, redis } = setup();
      for (let i = 0; i < 20; i++) {
        await service.issue(issueInput(service, { email: `ip${i}@example.com`, deviceId: `d${i}` }));
      }
      const err = await rejection(service.issue(issueInput(service, { email: 'ip20@example.com', deviceId: 'd20' })));
      expect(err.code).toBe(ErrorCode.TooManyRequests);
      expect(err.details?.retryAfterSeconds).toBeGreaterThan(3590);
      // No code was issued: the cooldown and the identifier slot are handed back.
      const hash = service.rateLimitHash(IdentifierType.Email, 'ip20@example.com');
      expect(redis.strings.has(otpCooldownKey(OtpPurpose.Login, hash))).toBe(false);
      expect(redis.zsets.get(otpHourlyKey(OtpPurpose.Login, hash))).toEqual([]);
      // Step-up from the same IP has its own count.
      await expect(service.issue(issueInput(service, { purpose: OtpPurpose.Reauth, deviceId: 'mine' }))).resolves.toBeDefined();
    });

    it('an IPv6 /64 is one IP for the cap', async () => {
      const { service, redis } = setup();
      await service.issue(issueInput(service, { requestIp: '2001:db8:1:2::1' }));
      await service.issue(issueInput(service, { email: 'b@example.com', requestIp: '2001:db8:1:2:ffff::9' }));
      expect(redis.zsets.get(otpIpKey(OtpPurpose.Login, '2001:db8:1:2::5'))).toHaveLength(2);
    });

    it('per device: the 11th code within an hour from one X-Device-Id → 429, other devices unaffected', async () => {
      const { service, redis } = setup();
      for (let i = 0; i < 10; i++) {
        await service.issue(issueInput(service, { email: `u${i}@example.com`, deviceId: 'shared-device' }));
      }
      const err = await rejection(service.issue(issueInput(service, { email: 'u10@example.com', deviceId: 'shared-device' })));
      expect(err.code).toBe(ErrorCode.TooManyRequests);
      expect(err.details?.retryAfterSeconds).toBeGreaterThan(3590);
      // The refused request's identifier slot was handed back.
      expect(redis.zsets.get(otpHourlyKey(OtpPurpose.Login, service.rateLimitHash(IdentifierType.Email, 'u10@example.com')))).toEqual([]);
      await expect(service.issue(issueInput(service, { email: 'u11@example.com', deviceId: 'other-device' }))).resolves.toBeDefined();
    });

    it('per device: requests without X-Device-Id share one bucket per IP', async () => {
      const { service, redis } = setup();
      for (let i = 0; i < 10; i++) {
        await service.issue(issueInput(service, { email: `n${i}@example.com`, deviceId: undefined, requestIp: '198.51.100.7' }));
      }
      expect(redis.zsets.get(otpDeviceKey(OtpPurpose.Login, undefined, '198.51.100.7'))).toHaveLength(10);
      await expect(
        service.issue(issueInput(service, { email: 'n10@example.com', deviceId: undefined, requestIp: '198.51.100.7' })),
      ).rejects.toMatchObject({ code: ErrorCode.TooManyRequests });
      await expect(
        service.issue(issueInput(service, { email: 'n11@example.com', deviceId: undefined, requestIp: '198.51.100.8' })),
      ).resolves.toBeDefined();
    });

    it('step-up has its own cooldown and hourly cap: sign-in spam never blocks it', async () => {
      const { service, redis } = setup();
      for (let i = 0; i < 5; i++) {
        if (i > 0) redis.strings.clear(); // the cooldown passing
        await service.issue(issueInput(service, { deviceId: `spam-${i}` }));
      }
      // Sign-in is in cooldown and at its hourly cap for this identifier…
      await expect(service.issue(issueInput(service, { deviceId: 'spam-5' }))).rejects.toMatchObject({ code: ErrorCode.OtpCooldown });
      // …step-up is not.
      await expect(service.issue(issueInput(service, { purpose: OtpPurpose.Reauth, deviceId: 'mine' }))).resolves.toBeDefined();
      expect(redis.set).toHaveBeenLastCalledWith(otpCooldownKey(OtpPurpose.Reauth, hashOf(service)), '1', 'EX', 60, 'NX');
    });

    it('the step-up hourly cap is OTP_REAUTH_MAX_PER_HOUR', async () => {
      const model: ModelMock = {
        findOne: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        min: jest.fn(),
        update: jest.fn().mockResolvedValue([1]),
        create: jest.fn((attrs: Record<string, unknown>) => Promise.resolve({ id: 'r', ...attrs })),
      };
      const redis = fakeWindowRedis();
      const service = new OtpService(model as unknown as typeof OtpVerification, redis as never, createTestConfig({ otp: { reauthMaxRequestsPerHour: 2 } }));
      for (let i = 0; i < 2; i++) {
        await service.issue(issueInput(service, { purpose: OtpPurpose.Reauth, deviceId: `d${i}` }));
        redis.strings.clear();
      }
      await expect(service.issue(issueInput(service, { purpose: OtpPurpose.Reauth, deviceId: 'd3' }))).rejects.toMatchObject({
        code: ErrorCode.TooManyRequests,
      });
    });

    it('expires older active codes of the same identifier and purpose only, before inserting', async () => {
      const { service, model } = setup();
      await service.issue(issueInput(service, { purpose: OtpPurpose.Reauth }));
      const [changes, opts] = model.update.mock.calls[0];
      expect(changes).toHaveProperty('expiresAt');
      expect(opts.where).toMatchObject({ identifierHash: hashOf(service), purpose: 'reauth', consumedAt: null });
      expect(model.update.mock.invocationCallOrder[0]).toBeLessThan(model.create.mock.invocationCallOrder[0]);
    });

    it('release (failed delivery) hands back the cooldown, identifier and device slots; the IP slot stays used', async () => {
      const { service, redis } = setup();
      const issued = await service.issue(issueInput(service));
      await issued.release();
      expect(redis.del).toHaveBeenCalledWith(otpCooldownKey(OtpPurpose.Login, hashOf(service)));
      expect(redis.zsets.get(otpHourlyKey(OtpPurpose.Login, hashOf(service)))).toEqual([]);
      expect(redis.zsets.get(otpDeviceKey(OtpPurpose.Login, 'device-1', '203.0.113.5'))).toEqual([]);
      expect(redis.zsets.get(otpIpKey(OtpPurpose.Login, '203.0.113.5'))).toHaveLength(1);
    });

    it('an unexpected Redis or MySQL failure hands back the cooldown and every slot taken', async () => {
      const { service, model, redis } = setup();
      model.create.mockRejectedValueOnce(new Error('db down'));
      await expect(service.issue(issueInput(service))).rejects.toThrow('db down');
      expect(redis.strings.size).toBe(0);
      for (const z of redis.zsets.values()) expect(z).toEqual([]);
    });
  });

  describe('verify', () => {
    it('looks up the newest active code for the purpose and channel', async () => {
      const { service, model } = setup();
      await service.verify(verifyInput(service, '123456'));
      expect(model.findOne.mock.calls[0][0].where).toMatchObject({ purpose: 'login', channel: 'email', consumedAt: null });
      expect(model.findOne.mock.calls[0][0].order).toEqual([['createdAt', 'DESC']]);
    });

    it('not found → not_found', async () => {
      const { service } = setup();
      await expect(service.verify(verifyInput(service, '123456'))).resolves.toEqual({ ok: false, reason: 'not_found' });
    });

    it('reserves an attempt atomically (attempts < max) before comparing', async () => {
      const { service, model } = setup();
      model.findOne.mockResolvedValue(record(service, '123456'));
      model.update.mockResolvedValueOnce([1]).mockResolvedValueOnce([1]);
      await expect(service.verify(verifyInput(service, '123456'))).resolves.toMatchObject({ ok: true });
      const where = model.update.mock.calls[0][1].where;
      expect(where).toMatchObject({ id: 'rec-1', consumedAt: null });
      expect(Object.getOwnPropertySymbols(where.attempts)).toHaveLength(1);
      // Then the conditional consume.
      expect(model.update.mock.calls[1][1].where).toEqual({ id: 'rec-1', consumedAt: null });
    });

    it('a wrong code uses an attempt; the 5th wrong one reports attempts_exceeded', async () => {
      const { service, model } = setup();
      model.findOne.mockResolvedValue(record(service, '123456', { attempts: 3 }));
      await expect(service.verify(verifyInput(service, '000000'))).resolves.toEqual({ ok: false, reason: 'mismatch' });
      model.findOne.mockResolvedValue(record(service, '123456', { attempts: 4 }));
      await expect(service.verify(verifyInput(service, '000000'))).resolves.toEqual({ ok: false, reason: 'attempts_exceeded' });
    });

    it('after 5 attempts even the right code fails, without another write', async () => {
      const { service, model } = setup();
      model.findOne.mockResolvedValue(record(service, '123456', { attempts: 5 }));
      await expect(service.verify(verifyInput(service, '123456'))).resolves.toEqual({ ok: false, reason: 'attempts_exceeded' });
      expect(model.update).not.toHaveBeenCalled();
    });

    it('lost attempt reservation (a parallel guess used the last one) → attempts_exceeded', async () => {
      const { service, model } = setup();
      model.findOne.mockResolvedValue(record(service, '123456', { attempts: 4 }));
      model.update.mockResolvedValueOnce([0]);
      await expect(service.verify(verifyInput(service, '123456'))).resolves.toEqual({ ok: false, reason: 'attempts_exceeded' });
    });

    it('lost consume race (a parallel verify won) → not_found', async () => {
      const { service, model } = setup();
      model.findOne.mockResolvedValue(record(service, '123456'));
      model.update.mockResolvedValueOnce([1]).mockResolvedValueOnce([0]);
      await expect(service.verify(verifyInput(service, '123456'))).resolves.toEqual({ ok: false, reason: 'not_found' });
    });

    it('no identifier hashes (step-up for an account without a verified identifier) → not_found, no query', async () => {
      const { service, model } = setup();
      await expect(service.verify({ ...verifyInput(service, '1'), identifierHashes: [] })).resolves.toMatchObject({ ok: false });
      expect(model.findOne).not.toHaveBeenCalled();
    });
  });
});
