import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { literal, Op, type Transaction, type WhereOptions } from 'sequelize';

import { AppException, ErrorCode } from '../../common/exceptions/app.exception';
import { hmacSha256, timingSafeEqualHex } from '../../common/utils/hmac';
import type { RequestContext } from '../../common/utils/request-context';
import type { OtpConfig } from '../../config/otp.config';
import { IdentifierType, OtpVerification } from '../models/otp-verification.model';
import { generateNumericOtp } from '../utils/crypto.util';

/** Generic per-IP hourly cap on OTP issuance (defence against enumeration/SMS pumping). */
export const OTP_MAX_REQUESTS_PER_IP_PER_HOUR = 20;
const ONE_HOUR_MS = 60 * 60 * 1000;

export type OtpFailureReason = 'not_found' | 'attempts_exceeded' | 'mismatch';

export type OtpVerifyResult =
  | { ok: true; record: OtpVerification }
  | { ok: false; reason: OtpFailureReason; attemptsRemaining?: number };

export interface IssuedOtp {
  /** Plaintext OTP — in memory only, handed to the delivery provider. */
  otp: string;
  record: OtpVerification;
}

@Injectable()
export class OtpService {
  constructor(
    @InjectModel(OtpVerification)
    private readonly otpModel: typeof OtpVerification,
    private readonly config: ConfigService,
  ) {}

  private get cfg(): OtpConfig {
    return this.config.getOrThrow<OtpConfig>('otp');
  }

  private now(): Date {
    return new Date();
  }

  hashIdentifier(type: IdentifierType, normalizedIdentifier: string): string {
    return hmacSha256(this.cfg.hashSecret, `${type}:${normalizedIdentifier}`);
  }

  hashOtp(identifierHash: string, otp: string): string {
    return hmacSha256(this.cfg.hashSecret, `otp:${identifierHash}:${otp}`);
  }

  get ttlSeconds(): number {
    return this.cfg.ttlSeconds;
  }

  get resendCooldownSeconds(): number {
    return this.cfg.resendCooldownSeconds;
  }

  async issue(
    type: IdentifierType,
    identifier: string,
    userId: string | null,
    ctx: RequestContext,
    transaction?: Transaction,
  ): Promise<IssuedOtp> {
    const cfg = this.cfg;
    const now = this.now();
    const identifierHash = this.hashIdentifier(type, identifier);

    const latest = await this.otpModel.findOne({
      where: { identifierHash, identifierType: type },
      order: [['createdAt', 'DESC']],
      transaction,
    });
    if (latest && cfg.resendCooldownSeconds > 0) {
      const elapsedMs = now.getTime() - latest.createdAt.getTime();
      const cooldownMs = cfg.resendCooldownSeconds * 1000;
      if (elapsedMs < cooldownMs) {
        const retryAfterSeconds = Math.max(1, Math.ceil((cooldownMs - elapsedMs) / 1000));
        throw new AppException(ErrorCode.OtpCooldown, { retryAfterSeconds });
      }
    }

    const hourAgo = new Date(now.getTime() - ONE_HOUR_MS);
    const identifierWhere = { identifierHash, identifierType: type, createdAt: { [Op.gt]: hourAgo } };
    const identifierCount = await this.otpModel.count({ where: identifierWhere, transaction });
    if (identifierCount >= cfg.maxRequestsPerHour) {
      throw await this.tooManyRequests(identifierWhere, now, transaction);
    }

    if (ctx.ipAddress) {
      const ipWhere = { requestIp: ctx.ipAddress, createdAt: { [Op.gt]: hourAgo } };
      const ipCount = await this.otpModel.count({ where: ipWhere, transaction });
      if (ipCount >= OTP_MAX_REQUESTS_PER_IP_PER_HOUR) {
        throw await this.tooManyRequests(ipWhere, now, transaction);
      }
    }

    // Only one active code per identifier at any time.
    await this.otpModel.update(
      { expiresAt: now },
      {
        where: {
          identifierHash,
          identifierType: type,
          consumedAt: null,
          expiresAt: { [Op.gt]: now },
        },
        transaction,
      },
    );

    const otp = generateNumericOtp(cfg.length);
    const record = await this.otpModel.create(
      {
        userId,
        identifierHash,
        identifierType: type,
        otpHash: this.hashOtp(identifierHash, otp),
        expiresAt: new Date(now.getTime() + cfg.ttlSeconds * 1000),
        attempts: 0,
        maxAttempts: cfg.maxAttempts,
        consumedAt: null,
        requestIp: ctx.ipAddress,
      },
      { transaction },
    );
    return { otp, record };
  }

  async verify(
    type: IdentifierType,
    identifier: string,
    otp: string,
    transaction?: Transaction,
  ): Promise<OtpVerifyResult> {
    const now = this.now();
    const identifierHash = this.hashIdentifier(type, identifier);
    const candidateHash = this.hashOtp(identifierHash, otp);

    const record = await this.otpModel.findOne({
      where: {
        identifierHash,
        identifierType: type,
        consumedAt: null,
        expiresAt: { [Op.gt]: now },
      },
      order: [['createdAt', 'DESC']],
      transaction,
    });

    if (!record) {
      // Timing parity with the found path.
      timingSafeEqualHex(candidateHash, this.hashOtp(identifierHash, 'dummy'));
      return { ok: false, reason: 'not_found' };
    }

    const maxAttempts = Math.min(record.maxAttempts, this.cfg.maxAttempts);
    if (record.attempts >= maxAttempts) {
      return { ok: false, reason: 'attempts_exceeded', attemptsRemaining: 0 };
    }

    // Reserve an attempt atomically before comparing — defeats parallel brute force.
    const [reserved] = await this.otpModel.update(
      { attempts: literal('attempts + 1') },
      {
        where: {
          id: record.id,
          consumedAt: null,
          attempts: { [Op.lt]: maxAttempts },
          expiresAt: { [Op.gt]: now },
        },
        transaction,
      },
    );
    if (reserved === 0) {
      return { ok: false, reason: 'attempts_exceeded', attemptsRemaining: 0 };
    }

    const attemptsUsed = record.attempts + 1;
    if (!timingSafeEqualHex(candidateHash, record.otpHash)) {
      const attemptsRemaining = Math.max(0, maxAttempts - attemptsUsed);
      return {
        ok: false,
        reason: attemptsRemaining === 0 ? 'attempts_exceeded' : 'mismatch',
        attemptsRemaining,
      };
    }

    const consumedAt = this.now();
    const [consumed] = await this.otpModel.update(
      { consumedAt },
      { where: { id: record.id, consumedAt: null }, transaction },
    );
    if (consumed === 0) {
      // Lost a race with a concurrent verification of the same code.
      return { ok: false, reason: 'not_found' };
    }
    record.consumedAt = consumedAt;
    record.attempts = attemptsUsed;
    return { ok: true, record };
  }

  async linkUser(recordId: string, userId: string, transaction?: Transaction): Promise<void> {
    await this.otpModel.update({ userId }, { where: { id: recordId }, transaction });
  }

  /** The window frees a slot when its oldest code turns one hour old. */
  private async tooManyRequests(
    where: WhereOptions<OtpVerification>,
    now: Date,
    transaction?: Transaction,
  ): Promise<AppException> {
    const oldest = await this.otpModel.min<Date | null, OtpVerification>('createdAt', { where, transaction });
    const freesAt = oldest ? new Date(oldest).getTime() + ONE_HOUR_MS : now.getTime() + ONE_HOUR_MS;
    const retryAfterSeconds = Math.max(1, Math.ceil((freesAt - now.getTime()) / 1000));
    return new AppException(ErrorCode.TooManyRequests, { retryAfterSeconds });
  }
}
