import 'reflect-metadata';

import { HttpStatus } from '@nestjs/common';

import { AppException, ErrorCode } from '../../common/exceptions/app.exception';
import { IdentifierType, type OtpVerification } from '../models/otp-verification.model';
import { createTestConfig, TEST_OTP_CONFIG } from '../testing/test-config';
import { OtpService } from './otp.service';

type ModelMock = {
  findOne: jest.Mock;
  count: jest.Mock;
  update: jest.Mock;
  create: jest.Mock;
};

const EMAIL = 'jane@example.com';
const ctx = { ipAddress: '203.0.113.5', userAgent: 'jest' };

function setup(): { service: OtpService; model: ModelMock } {
  const model: ModelMock = {
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    update: jest.fn().mockResolvedValue([1]),
    create: jest.fn((attrs: Record<string, unknown>) => Promise.resolve({ id: 'rec-1', ...attrs })),
  };
  const service = new OtpService(model as unknown as typeof OtpVerification, createTestConfig());
  return { service, model };
}

function record(service: OtpService, otp: string, overrides: Partial<OtpVerification> = {}): OtpVerification {
  const identifierHash = service.hashIdentifier(IdentifierType.Email, EMAIL);
  return {
    id: 'rec-1',
    identifierHash,
    identifierType: IdentifierType.Email,
    otpHash: service.hashOtp(identifierHash, otp),
    attempts: 0,
    maxAttempts: TEST_OTP_CONFIG.maxAttempts,
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ...overrides,
  } as OtpVerification;
}

describe('OtpService', () => {
  describe('issue', () => {
    it('stores only hashed values and returns plaintext in memory', async () => {
      const { service, model } = setup();
      const { otp, record: rec } = await service.issue(IdentifierType.Email, EMAIL, null, ctx);
      expect(otp).toMatch(/^\d{6}$/);
      const attrs = model.create.mock.calls[0][0] as Record<string, unknown>;
      expect(attrs.otpHash).toMatch(/^[0-9a-f]{64}$/);
      expect(attrs.otpHash).not.toBe(otp);
      expect(attrs.identifierHash).not.toContain(EMAIL);
      expect(JSON.stringify(attrs)).not.toContain(EMAIL);
      expect(JSON.stringify(attrs)).not.toContain(`"${otp}"`);
      expect(attrs.maxAttempts).toBe(TEST_OTP_CONFIG.maxAttempts);
      expect(rec.id).toBe('rec-1');
      // previous active codes invalidated
      expect(model.update).toHaveBeenCalledWith(
        { expiresAt: expect.any(Date) },
        expect.objectContaining({ where: expect.objectContaining({ consumedAt: null }) }),
      );
    });

    it('throws 429 OTP_COOLDOWN with retryAfterSeconds inside cooldown', async () => {
      const { service, model } = setup();
      model.findOne.mockResolvedValue({ createdAt: new Date(Date.now() - 10_000) });
      const err = await service.issue(IdentifierType.Email, EMAIL, null, ctx).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppException);
      const appErr = err as AppException;
      expect(appErr.code).toBe(ErrorCode.OtpCooldown);
      expect(appErr.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(appErr.details?.retryAfterSeconds).toBe(50);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('allows a new code after cooldown elapsed', async () => {
      const { service, model } = setup();
      model.findOne.mockResolvedValue({ createdAt: new Date(Date.now() - 61_000) });
      await expect(service.issue(IdentifierType.Email, EMAIL, null, ctx)).resolves.toBeDefined();
    });

    it('enforces hourly per-identifier cap', async () => {
      const { service, model } = setup();
      model.count.mockResolvedValueOnce(TEST_OTP_CONFIG.maxRequestsPerHour);
      await expect(service.issue(IdentifierType.Email, EMAIL, null, ctx)).rejects.toMatchObject({
        code: ErrorCode.TooManyRequests,
      });
    });

    it('enforces per-IP hourly cap', async () => {
      const { service, model } = setup();
      model.count.mockResolvedValueOnce(0).mockResolvedValueOnce(20);
      await expect(service.issue(IdentifierType.Email, EMAIL, null, ctx)).rejects.toMatchObject({
        code: ErrorCode.TooManyRequests,
      });
    });
  });

  describe('verify', () => {
    it('succeeds with correct code and consumes it atomically', async () => {
      const { service, model } = setup();
      model.findOne.mockResolvedValue(record(service, '123456'));
      const result = await service.verify(IdentifierType.Email, EMAIL, '123456');
      expect(result.ok).toBe(true);
      expect(model.update).toHaveBeenCalledTimes(2);
      expect(model.update.mock.calls[1][1]).toEqual(
        expect.objectContaining({ where: { id: 'rec-1', consumedAt: null } }),
      );
    });

    it('fails when no active (unexpired/unconsumed) record exists', async () => {
      const { service, model } = setup();
      model.findOne.mockResolvedValue(null);
      await expect(service.verify(IdentifierType.Email, EMAIL, '123456')).resolves.toEqual({
        ok: false,
        reason: 'not_found',
      });
      const where = (model.findOne.mock.calls[0][0] as { where: Record<string | symbol, unknown> }).where;
      expect(where.consumedAt).toBeNull();
      expect(where.expiresAt).toBeDefined();
      expect(model.update).not.toHaveBeenCalled();
    });

    it('treats an expired code as not found (expiry enforced via query + fake timers)', async () => {
      jest.useFakeTimers();
      try {
        const { service, model } = setup();
        const rec = record(service, '123456', { expiresAt: new Date(Date.now() + 300_000) });
        jest.advanceTimersByTime(301_000);
        // Emulate the DB applying `expiresAt > now`.
        model.findOne.mockImplementation(() => {
          return Promise.resolve(rec.expiresAt.getTime() > Date.now() ? rec : null);
        });
        const result = await service.verify(IdentifierType.Email, EMAIL, '123456');
        expect(result).toEqual({ ok: false, reason: 'not_found' });
      } finally {
        jest.useRealTimers();
      }
    });

    it('increments attempts on mismatch', async () => {
      const { service, model } = setup();
      model.findOne.mockResolvedValue(record(service, '123456', { attempts: 1 }));
      const result = await service.verify(IdentifierType.Email, EMAIL, '654321');
      expect(result).toEqual({ ok: false, reason: 'mismatch', attemptsRemaining: 3 });
      expect(model.update).toHaveBeenCalledTimes(1);
      const [values, opts] = model.update.mock.calls[0] as [Record<string, unknown>, { where: Record<string, unknown> }];
      expect(values.attempts).toBeDefined();
      expect(opts.where.id).toBe('rec-1');
      expect(opts.where.attempts).toBeDefined();
    });

    it('reports attempts_exceeded on the final wrong attempt', async () => {
      const { service, model } = setup();
      model.findOne.mockResolvedValue(record(service, '123456', { attempts: 4 }));
      const result = await service.verify(IdentifierType.Email, EMAIL, '000000');
      expect(result).toEqual({ ok: false, reason: 'attempts_exceeded', attemptsRemaining: 0 });
    });

    it('rejects even the correct code once attempts >= max', async () => {
      const { service, model } = setup();
      model.findOne.mockResolvedValue(record(service, '123456', { attempts: 5 }));
      const result = await service.verify(IdentifierType.Email, EMAIL, '123456');
      expect(result).toMatchObject({ ok: false, reason: 'attempts_exceeded' });
      expect(model.update).not.toHaveBeenCalled();
    });

    it('fails when the conditional attempt reservation affects 0 rows (race)', async () => {
      const { service, model } = setup();
      model.findOne.mockResolvedValue(record(service, '123456', { attempts: 4 }));
      model.update.mockResolvedValueOnce([0]);
      const result = await service.verify(IdentifierType.Email, EMAIL, '123456');
      expect(result).toMatchObject({ ok: false, reason: 'attempts_exceeded' });
      expect(model.update).toHaveBeenCalledTimes(1);
    });

    it('fails when consume update loses a race', async () => {
      const { service, model } = setup();
      model.findOne.mockResolvedValue(record(service, '123456'));
      model.update.mockResolvedValueOnce([1]).mockResolvedValueOnce([0]);
      const result = await service.verify(IdentifierType.Email, EMAIL, '123456');
      expect(result).toEqual({ ok: false, reason: 'not_found' });
    });
  });
});
