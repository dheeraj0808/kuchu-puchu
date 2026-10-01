import 'reflect-metadata';

import { createHmac } from 'node:crypto';

import { HttpStatus } from '@nestjs/common';

import { AppException, ErrorCode } from '../../common/exceptions/app.exception';
import { IdentifierType, OtpChannel, OtpPurpose, type OtpVerification } from '../models/otp-verification.model';
import { createTestConfig, TEST_OTP_CONFIG } from '../testing/test-config';
import { otpCooldownKey, OtpService } from './otp.service';

type ModelMock = {
  findOne: jest.Mock;
  count: jest.Mock;
  min: jest.Mock;
  update: jest.Mock;
  create: jest.Mock;
};

const EMAIL = 'jane@example.com';

function setup(): { service: OtpService; model: ModelMock; redis: { set: jest.Mock; pttl: jest.Mock; del: jest.Mock } } {
  const model: ModelMock = {
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    min: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue([1]),
    create: jest.fn((attrs: Record<string, unknown>) => Promise.resolve({ id: 'rec-1', ...attrs })),
  };
  const redis = { set: jest.fn().mockResolvedValue('OK'), pttl: jest.fn().mockResolvedValue(42_100), del: jest.fn().mockResolvedValue(1) };
  const service = new OtpService(model as unknown as typeof OtpVerification, redis as never, createTestConfig());
  return { service, model, redis };
}

function hashOf(service: OtpService): string {
  return service.hashIdentifier(IdentifierType.Email, EMAIL);
}

function issueInput(service: OtpService) {
  return { identifierHash: hashOf(service), channel: OtpChannel.Email, purpose: OtpPurpose.Login, requestIp: '203.0.113.5' };
}

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

  describe('issue', () => {
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

    it('takes the cooldown with one atomic SET NX EX 60 per identifier', async () => {
      const { service, redis } = setup();
      await service.issue(issueInput(service));
      expect(redis.set).toHaveBeenCalledWith(otpCooldownKey(hashOf(service)), '1', 'EX', 60, 'NX');
    });

    it('cooldown taken → 429 OTP_COOLDOWN with retryAfterSeconds from the key TTL; nothing written', async () => {
      const { service, model, redis } = setup();
      redis.set.mockResolvedValue(null);
      const err = (await service.issue(issueInput(service)).catch((e: unknown) => e)) as AppException;
      expect(err.code).toBe(ErrorCode.OtpCooldown);
      expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(err.details).toEqual({ retryAfterSeconds: 43 });
      expect(model.create).not.toHaveBeenCalled();
    });

    it('5 codes in the last hour for the identifier → 429 TOO_MANY_REQUESTS until the oldest ages out', async () => {
      const { service, model } = setup();
      model.count.mockResolvedValueOnce(5);
      model.min.mockResolvedValue(new Date(Date.now() - 50 * 60_000));
      const err = (await service.issue(issueInput(service)).catch((e: unknown) => e)) as AppException;
      expect(err.code).toBe(ErrorCode.TooManyRequests);
      expect(err.details?.retryAfterSeconds).toBeGreaterThan(590);
      expect(err.details?.retryAfterSeconds).toBeLessThanOrEqual(600);
    });

    it('20 codes in the last hour from the IP (OTP_MAX_PER_IP_PER_HOUR) → 429', async () => {
      const { service, model } = setup();
      model.count.mockResolvedValueOnce(0).mockResolvedValueOnce(20);
      const { redis } = { redis: (service as unknown as { redis: { del: jest.Mock } }).redis };
      await expect(service.issue(issueInput(service))).rejects.toMatchObject({ code: ErrorCode.TooManyRequests });
      expect(model.count.mock.calls[1][0].where).toMatchObject({ requestIp: '203.0.113.5' });
      // No code was issued, so the cooldown is handed back.
      expect(redis.del).toHaveBeenCalledWith(otpCooldownKey(hashOf(service)));
    });

    it('expires every older active code of the identifier before inserting (one active code)', async () => {
      const { service, model } = setup();
      await service.issue(issueInput(service));
      const [changes, opts] = model.update.mock.calls[0];
      expect(changes).toHaveProperty('expiresAt');
      expect(opts.where).toMatchObject({ identifierHash: hashOf(service), consumedAt: null });
      expect(model.update.mock.invocationCallOrder[0]).toBeLessThan(model.create.mock.invocationCallOrder[0]);
    });

    it('releaseCooldown deletes the cooldown key', async () => {
      const { service, redis } = setup();
      const issued = await service.issue(issueInput(service));
      await issued.releaseCooldown();
      expect(redis.del).toHaveBeenCalledWith(otpCooldownKey(hashOf(service)));
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
