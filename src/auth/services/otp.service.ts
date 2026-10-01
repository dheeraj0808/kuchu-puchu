import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import type { Redis } from 'ioredis';
import { literal, Op, type WhereOptions } from 'sequelize';

import { AppException, ErrorCode } from '../../common/exceptions/app.exception';
import { hmacSha256, timingSafeEqualHex } from '../../common/utils/hmac';
import type { OtpConfig } from '../../config/otp.config';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { redisKey } from '../../infra/redis/redis-keys';
import { type IdentifierType, type OtpChannel, type OtpPurpose, OtpVerification } from '../models/otp-verification.model';
import { generateNumericOtp } from '../utils/crypto.util';

const ONE_HOUR_MS = 60 * 60 * 1000;

export type OtpFailureReason = 'not_found' | 'attempts_exceeded' | 'mismatch';

export type OtpVerifyResult =
  | { ok: true; record: OtpVerification }
  | { ok: false; reason: OtpFailureReason };

export interface IssueOtpInput {
  identifierHash: string;
  channel: OtpChannel;
  purpose: OtpPurpose;
  requestIp: string;
}

export interface IssuedOtp {
  /** Plaintext code: in memory only, handed to the delivery adapter. */
  otp: string;
  record: OtpVerification;
  /** Frees the cooldown again, e.g. when the code could not be delivered. */
  releaseCooldown: () => Promise<void>;
}

export interface VerifyOtpInput {
  /** The code may belong to any of these identifiers (step-up: the account's phone or email). */
  identifierHashes: string[];
  purpose: OtpPurpose;
  /** Login codes must come from the channel they were requested on. */
  channel?: OtpChannel;
  otp: string;
}

export function otpCooldownKey(identifierHash: string): string {
  return redisKey('otp-cooldown', identifierHash);
}

/**
 * Codes (guide M06): 6 digits from a CSPRNG, stored as an HMAC, valid
 * OTP_TTL_SECONDS, OTP_MAX_ATTEMPTS tries, one active code per identifier,
 * consumed once. Issuance is gated by an atomic per-identifier cooldown in
 * Redis, then by hourly caps per identifier and per IP counted in MySQL.
 */
@Injectable()
export class OtpService {
  constructor(
    @InjectModel(OtpVerification) private readonly otpModel: typeof OtpVerification,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  private get cfg(): OtpConfig {
    return this.config.getOrThrow<OtpConfig>('otp');
  }

  /** HMAC-SHA256(OTP_HASH_SECRET, "<type>:<normalised>"); the identifier is never stored. */
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

  /**
   * Issues a code. Throws 429 OTP_COOLDOWN or TOO_MANY_REQUESTS with
   * details.retryAfterSeconds. The cooldown is one SET NX per identifier, so
   * parallel requests for the same identifier cannot both pass it; that is
   * also what keeps "one active code per identifier" true under races.
   */
  async issue(input: IssueOtpInput): Promise<IssuedOtp> {
    const cfg = this.cfg;
    const { identifierHash } = input;
    const cooldownKey = otpCooldownKey(identifierHash);
    const releaseCooldown = async (): Promise<void> => {
      await this.redis.del(cooldownKey).catch(() => undefined);
    };

    if (cfg.resendCooldownSeconds > 0) {
      const set = await this.redis.set(cooldownKey, '1', 'EX', cfg.resendCooldownSeconds, 'NX');
      if (set !== 'OK') {
        const ttlMs = await this.redis.pttl(cooldownKey);
        const retryAfterSeconds = Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : cfg.resendCooldownSeconds * 1000) / 1000));
        throw new AppException(ErrorCode.OtpCooldown, { retryAfterSeconds });
      }
    }

    const now = new Date();
    const hourAgo = new Date(now.getTime() - ONE_HOUR_MS);
    const identifierWhere = { identifierHash, createdAt: { [Op.gt]: hourAgo } };
    if ((await this.otpModel.count({ where: identifierWhere })) >= cfg.maxRequestsPerHour) {
      throw await this.tooManyRequests(identifierWhere, now);
    }
    const ipWhere = { requestIp: input.requestIp, createdAt: { [Op.gt]: hourAgo } };
    if ((await this.otpModel.count({ where: ipWhere })) >= cfg.maxRequestsPerIpPerHour) {
      throw await this.tooManyRequests(ipWhere, now);
    }

    // One active code per identifier: a new code (either purpose) expires the older ones.
    await this.otpModel.update(
      { expiresAt: now },
      { where: { identifierHash, consumedAt: null, expiresAt: { [Op.gt]: now } } },
    );

    const otp = generateNumericOtp(cfg.length);
    const record = await this.otpModel.create({
      identifierHash,
      channel: input.channel,
      purpose: input.purpose,
      otpHash: this.hashOtp(identifierHash, otp),
      attempts: 0,
      expiresAt: new Date(now.getTime() + cfg.ttlSeconds * 1000),
      consumedAt: null,
      requestIp: input.requestIp,
    });
    return { otp, record, releaseCooldown };
  }

  /**
   * Checks a code against the newest active one. Each try first reserves an
   * attempt (attempts = attempts + 1 WHERE attempts < max), so parallel
   * guesses cannot exceed the limit; the code is then consumed by a
   * conditional update, so only one of several parallel correct verifies wins.
   * Callers answer every failure the same way (401 OTP_INVALID).
   */
  async verify(input: VerifyOtpInput): Promise<OtpVerifyResult> {
    const maxAttempts = this.cfg.maxAttempts;
    const now = new Date();
    const record =
      input.identifierHashes.length === 0
        ? null
        : await this.otpModel.findOne({
            where: {
              identifierHash: { [Op.in]: input.identifierHashes },
              purpose: input.purpose,
              ...(input.channel ? { channel: input.channel } : {}),
              consumedAt: null,
              expiresAt: { [Op.gt]: now },
            },
            order: [['createdAt', 'DESC']],
          });

    if (!record) {
      // Same work as the found path.
      timingSafeEqualHex(this.hashOtp('-', input.otp), this.hashOtp('-', 'dummy'));
      return { ok: false, reason: 'not_found' };
    }
    const candidate = this.hashOtp(record.identifierHash, input.otp);
    if (record.attempts >= maxAttempts) return { ok: false, reason: 'attempts_exceeded' };

    const [reserved] = await this.otpModel.update(
      { attempts: literal('attempts + 1') },
      {
        where: {
          id: record.id,
          consumedAt: null,
          attempts: { [Op.lt]: maxAttempts },
          expiresAt: { [Op.gt]: now },
        },
      },
    );
    if (reserved === 0) return { ok: false, reason: 'attempts_exceeded' };

    if (!timingSafeEqualHex(candidate, record.otpHash)) {
      return { ok: false, reason: record.attempts + 1 >= maxAttempts ? 'attempts_exceeded' : 'mismatch' };
    }

    const consumedAt = new Date();
    const [consumed] = await this.otpModel.update({ consumedAt }, { where: { id: record.id, consumedAt: null } });
    // 0: a parallel verify of the same code consumed it first.
    if (consumed === 0) return { ok: false, reason: 'not_found' };
    record.consumedAt = consumedAt;
    record.attempts += 1;
    return { ok: true, record };
  }

  /** The window frees a slot when its oldest code turns one hour old. */
  private async tooManyRequests(where: WhereOptions<OtpVerification>, now: Date): Promise<AppException> {
    const oldest = await this.otpModel.min<Date | null, OtpVerification>('createdAt', { where });
    const freesAt = oldest ? new Date(oldest).getTime() + ONE_HOUR_MS : now.getTime() + ONE_HOUR_MS;
    const retryAfterSeconds = Math.max(1, Math.ceil((freesAt - now.getTime()) / 1000));
    return new AppException(ErrorCode.TooManyRequests, { retryAfterSeconds });
  }
}
