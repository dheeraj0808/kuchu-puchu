import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import type { Redis } from 'ioredis';
import { literal, Op } from 'sequelize';

import { AppException, ErrorCode } from '../../common/exceptions/app.exception';
import { hmacSha256, timingSafeEqualHex } from '../../common/utils/hmac';
import { ipBucket } from '../../common/utils/ip-bucket';
import type { OtpConfig } from '../../config/otp.config';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { redisKey } from '../../infra/redis/redis-keys';
import { takeWindowSlot, type WindowSlot } from '../../infra/redis/sliding-window';
import { type IdentifierType, type OtpChannel, OtpPurpose, OtpVerification } from '../models/otp-verification.model';
import { generateNumericOtp } from '../utils/crypto.util';
import { canonicalIdentifier } from '../utils/identifier.util';

const ONE_HOUR_MS = 60 * 60 * 1000;

export type OtpFailureReason = 'not_found' | 'attempts_exceeded' | 'mismatch';

export type OtpVerifyResult =
  | { ok: true; record: OtpVerification }
  | { ok: false; reason: OtpFailureReason };

export interface IssueOtpInput {
  /** hashIdentifier() of the exact identifier: stored, and what verify looks codes up by. */
  identifierHash: string;
  /** rateLimitHash(): the canonical form, so aliases of one mailbox share the cooldown and caps. */
  rateLimitHash: string;
  channel: OtpChannel;
  purpose: OtpPurpose;
  requestIp: string;
  /** X-Device-Id, when the request sent a valid one. */
  deviceId?: string;
}

export interface IssuedOtp {
  /** Plaintext code: in memory only, handed to the delivery adapter. */
  otp: string;
  record: OtpVerification;
  /**
   * The code could not be delivered: hands back the cooldown and the
   * identifier and device slots. The IP slot stays used, so repeated
   * delivery failures cannot be retried without limit.
   */
  release: () => Promise<void>;
}

export interface VerifyOtpInput {
  /** The code may belong to any of these identifiers (step-up: the account's phone or email). */
  identifierHashes: string[];
  purpose: OtpPurpose;
  /** Login codes must come from the channel they were requested on. */
  channel?: OtpChannel;
  otp: string;
}

/** Sign-in and step-up have separate keys, so code spam for one never blocks the other. */
export function otpCooldownKey(purpose: OtpPurpose, rateLimitHash: string): string {
  return redisKey('otp-cooldown', purpose, rateLimitHash);
}

export function otpHourlyKey(purpose: OtpPurpose, rateLimitHash: string): string {
  return redisKey('otp-hourly', purpose, rateLimitHash);
}

/** Per ipBucket(): an IPv6 /64 counts as one address. */
export function otpIpKey(purpose: OtpPurpose, requestIp: string): string {
  return redisKey('otp-ip', purpose, ipBucket(requestIp));
}

/**
 * Requests without an X-Device-Id share one bucket per IP (ipBucket). The
 * header is client-chosen, so this cap only slows honest-looking clients; the
 * per-IP cap is the real bound.
 */
export function otpDeviceKey(purpose: OtpPurpose, deviceId: string | undefined, requestIp: string): string {
  return deviceId ? redisKey('otp-device', purpose, deviceId) : redisKey('otp-no-device', purpose, ipBucket(requestIp));
}

/**
 * Codes (guide M06): 6 digits from a CSPRNG, stored as an HMAC, valid
 * OTP_TTL_SECONDS, OTP_MAX_ATTEMPTS tries, one active code per identifier and
 * purpose, consumed once. Issuance is gated, per purpose, by an atomic cooldown
 * and an hourly cap on the canonical identifier, an hourly cap per IP (an IPv6
 * /64 counts as one) and an hourly cap per device, all in Redis. Sign-in and step-up never share
 * a limit, so sign-in code spam cannot block a signed-in user's step-up.
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

  /** The same HMAC over the canonical form (canonicalIdentifier); equals hashIdentifier() when there is no alias. */
  rateLimitHash(type: IdentifierType, normalizedIdentifier: string): string {
    return this.hashIdentifier(type, canonicalIdentifier(type, normalizedIdentifier));
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
   * details.retryAfterSeconds. The cooldown is one SET NX per canonical
   * identifier and purpose, so parallel requests cannot both pass it; that is
   * also what keeps "one active code per identifier" true under races. A cap
   * that refuses hands back the cooldown and every slot already taken: no code
   * was issued, so there is nothing to wait for. The otp_verifications
   * (request_ip, created_at) index stays for investigations.
   */
  async issue(input: IssueOtpInput): Promise<IssuedOtp> {
    const cfg = this.cfg;
    const { identifierHash, purpose, requestIp } = input;
    const cooldownKey = otpCooldownKey(purpose, input.rateLimitHash);
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

    const taken: Array<() => Promise<void>> = [];
    const releaseAll = async (): Promise<void> => {
      await Promise.all(taken.map((r) => r()));
      await releaseCooldown();
    };
    let ipSlotRelease: (() => Promise<void>) | null = null;
    // Every cap is an atomic sliding window in Redis, so parallel requests can never overshoot it.
    const take = async (key: string, limit: number): Promise<() => Promise<void>> => {
      const slot: WindowSlot = await takeWindowSlot(this.redis, key, limit, ONE_HOUR_MS);
      if (!slot.taken) throw new AppException(ErrorCode.TooManyRequests, { retryAfterSeconds: slot.retryAfterSeconds });
      taken.push(slot.release);
      return slot.release;
    };

    try {
      const perIdentifier = purpose === OtpPurpose.Reauth ? cfg.reauthMaxRequestsPerHour : cfg.maxRequestsPerHour;
      await take(otpHourlyKey(purpose, input.rateLimitHash), perIdentifier);
      ipSlotRelease = await take(otpIpKey(purpose, requestIp), cfg.maxRequestsPerIpPerHour);
      await take(otpDeviceKey(purpose, input.deviceId, requestIp), cfg.maxRequestsPerDevicePerHour);

      const now = new Date();
      // One active code per identifier and purpose: a sign-in code never expires a pending step-up code.
      await this.otpModel.update(
        { expiresAt: now },
        { where: { identifierHash, purpose, consumedAt: null, expiresAt: { [Op.gt]: now } } },
      );

      const otp = generateNumericOtp(cfg.length);
      const record = await this.otpModel.create({
        identifierHash,
        channel: input.channel,
        purpose,
        otpHash: this.hashOtp(identifierHash, otp),
        attempts: 0,
        expiresAt: new Date(now.getTime() + cfg.ttlSeconds * 1000),
        consumedAt: null,
        requestIp,
      });
      const keepIpSlot = ipSlotRelease;
      const release = async (): Promise<void> => {
        await Promise.all(taken.filter((r) => r !== keepIpSlot).map((r) => r()));
        await releaseCooldown();
      };
      return { otp, record, release };
    } catch (err) {
      // A refusal, or a Redis / MySQL failure: no code was issued, so nothing stays used.
      await releaseAll();
      throw err;
    }
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
}
