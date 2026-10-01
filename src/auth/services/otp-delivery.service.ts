import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

import type { OtpConfig } from '../../config/otp.config';
import type { SmsConfig } from '../../config/messaging.config';
import { AlertProvider } from '../../infra/alerts/alert.provider';
import { EmailProvider } from '../../infra/email/email.provider';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { redisKey } from '../../infra/redis/redis-keys';
import { SmsProvider } from '../../infra/sms/sms.provider';
import { IdentifierType, OtpPurpose } from '../models/otp-verification.model';
import { maskIdentifier } from '../utils/mask.util';

/** IST is UTC+05:30 all year; the SMS budget resets at IST midnight. */
const IST_OFFSET_MS = 330 * 60_000;
/** Budget counters outlive their day by a day, for inspection. */
const BUDGET_KEY_TTL_SECONDS = 2 * 86_400;
/** Alert when this share of the daily budget is used. */
export const SMS_BUDGET_WARNING_RATIO = 0.8;

export type DeliveryOutcome = 'sent' | 'country_blocked' | 'budget_blocked';

export interface OtpDelivery {
  type: IdentifierType;
  /** Normalised email or E.164 phone. Never logged. */
  identifier: string;
  otp: string;
  purpose: OtpPurpose;
}

export function istDay(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function smsBudgetKey(day: string): string {
  return redisKey('sms-budget', day);
}

/**
 * Sends an OTP through the SMS or email adapter (guide M06). The SMS fraud
 * guard runs here: numbers outside OTP_SMS_ALLOWED_COUNTRIES, and every SMS
 * once the daily SMS_DAILY_BUDGET is used up, are not sent (the caller still
 * answers the same 200). Nothing here logs the identifier or the code; with
 * OTP_DEV_ECHO (never in production) the code goes straight to stdout.
 */
@Injectable()
export class OtpDeliveryService {
  constructor(
    private readonly sms: SmsProvider,
    private readonly email: EmailProvider,
    private readonly alerts: AlertProvider,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  /** Rejects when the adapter failed; the caller answers 503 OTP_DELIVERY_FAILED. */
  async send(delivery: OtpDelivery): Promise<DeliveryOutcome> {
    const otp = this.config.getOrThrow<OtpConfig>('otp');
    const expiresInMinutes = Math.max(1, Math.round(otp.ttlSeconds / 60));

    if (delivery.type === IdentifierType.Email) {
      await this.email.send({
        to: delivery.identifier,
        subject: 'Your Kuchu Puchu code',
        text: `${delivery.otp} is your Kuchu Puchu ${delivery.purpose === OtpPurpose.Reauth ? 'confirmation' : 'sign-in'} code. It expires in ${expiresInMinutes} minutes. Never share it with anyone.`,
      });
      this.echo(delivery);
      return 'sent';
    }

    if (!this.countryAllowed(delivery.identifier, otp.smsAllowedCountries)) return 'country_blocked';
    if (!(await this.takeSmsBudget())) return 'budget_blocked';
    await this.sms.sendOtp({ to: delivery.identifier, code: delivery.otp, expiresInMinutes });
    this.echo(delivery);
    return 'sent';
  }

  private countryAllowed(phone: string, allowed: string[]): boolean {
    const parsed = parsePhoneNumberFromString(phone);
    return parsed !== undefined && allowed.includes(`+${parsed.countryCallingCode}`);
  }

  /**
   * One INCR per SMS on kp:sms-budget:<IST date>. Exactly one request sees
   * the 80 % value and exactly one the first over-budget value, so each
   * alert fires once a day however many instances run.
   */
  private async takeSmsBudget(): Promise<boolean> {
    const budget = this.config.getOrThrow<SmsConfig>('sms').dailyBudget;
    const day = istDay();
    const key = smsBudgetKey(day);
    const [[incrErr, used]] = (await this.redis.multi().incr(key).expire(key, BUDGET_KEY_TTL_SECONDS).exec()) as [
      [Error | null, number],
      [Error | null, number],
    ];
    if (incrErr) throw incrErr;
    if (used === Math.ceil(budget * SMS_BUDGET_WARNING_RATIO) && used <= budget) {
      await this.alerts.send({ kind: 'sms_budget_warning', used, budget, day });
    }
    if (used <= budget) return true;
    if (used === budget + 1) await this.alerts.send({ kind: 'sms_budget_exhausted', used: budget, budget, day });
    return false;
  }

  private echo(delivery: OtpDelivery): void {
    if (!this.config.getOrThrow<OtpConfig>('otp').devEcho) return;
    process.stdout.write(`[DEV ONLY] OTP for ${maskIdentifier(delivery.type, delivery.identifier)}: ${delivery.otp}\n`);
  }
}
