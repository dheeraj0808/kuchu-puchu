import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

import type { OtpConfig } from '../../config/otp.config';
import type { EmailConfig, SmsConfig } from '../../config/messaging.config';
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
/** Alert when this share of a daily budget (each SMS pool, the email budget) is used. */
export const BUDGET_WARNING_RATIO = 0.8;

/**
 * SMS budget pools: `new` for identifiers no account holds, `existing` (the
 * reserve) for identifiers of accounts. Existing accounts fall back to the new
 * pool once their reserve is used up; new identifiers never touch the reserve.
 */
export type SmsBudgetPool = 'new' | 'existing';

export type DeliveryOutcome =
  | { status: 'sent'; pool?: SmsBudgetPool }
  | { status: 'country_blocked' }
  | { status: 'budget_blocked'; pool?: SmsBudgetPool };

export interface OtpDelivery {
  type: IdentifierType;
  /** Normalised email or E.164 phone. Never logged. */
  identifier: string;
  otp: string;
  purpose: OtpPurpose;
  /** The identifier belongs to an account: its SMS comes from the reserve. */
  existingAccount: boolean;
}

export function istDay(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function smsBudgetKey(pool: SmsBudgetPool, day: string): string {
  return redisKey('sms-budget', pool, day);
}

export function emailBudgetKey(day: string): string {
  return redisKey('email-budget', day);
}

/** The new-identifier pool's size; the reserve is the rest of the budget. */
export function smsPoolSizes(sms: Pick<SmsConfig, 'dailyBudget' | 'newIdentifierPercent'>): Record<SmsBudgetPool, number> {
  const fresh = Math.floor((sms.dailyBudget * sms.newIdentifierPercent) / 100);
  return { new: fresh, existing: sms.dailyBudget - fresh };
}

/**
 * Sends an OTP through the SMS or email adapter (guide M06). The fraud guards
 * run here: numbers outside OTP_SMS_ALLOWED_COUNTRIES, SMS once their budget
 * pool is used up, and email once EMAIL_DAILY_BUDGET is used up, are not sent
 * (the caller still answers the same 200). Nothing here logs the identifier or
 * the code; with OTP_DEV_ECHO (never in production) the code goes to stdout.
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
      const day = istDay();
      const budget = this.config.getOrThrow<EmailConfig>('email').dailyBudget;
      if (!(await this.takeBudget(emailBudgetKey(day), budget, { channel: 'email', day }))) return { status: 'budget_blocked' };
      await this.email.send({
        to: delivery.identifier,
        subject: 'Your Kuchu Puchu code',
        text: `${delivery.otp} is your Kuchu Puchu ${delivery.purpose === OtpPurpose.Reauth ? 'confirmation' : 'sign-in'} code. It expires in ${expiresInMinutes} minutes. Never share it with anyone.`,
      });
      this.echo(delivery);
      return { status: 'sent' };
    }

    if (!this.countryAllowed(delivery.identifier, otp.smsAllowedCountries)) return { status: 'country_blocked' };
    const pool = await this.takeSmsBudget(delivery.existingAccount);
    if (!pool) return { status: 'budget_blocked', pool: delivery.existingAccount ? 'existing' : 'new' };
    await this.sms.sendOtp({ to: delivery.identifier, code: delivery.otp, expiresInMinutes });
    this.echo(delivery);
    return { status: 'sent', pool };
  }

  private countryAllowed(phone: string, allowed: string[]): boolean {
    const parsed = parsePhoneNumberFromString(phone);
    return parsed !== undefined && allowed.includes(`+${parsed.countryCallingCode}`);
  }

  /** The pool the SMS was counted against, or null when none had room. */
  private async takeSmsBudget(existingAccount: boolean): Promise<SmsBudgetPool | null> {
    const sizes = smsPoolSizes(this.config.getOrThrow<SmsConfig>('sms'));
    const day = istDay();
    const pools: SmsBudgetPool[] = existingAccount ? ['existing', 'new'] : ['new'];
    for (const pool of pools) {
      // An empty pool (0 %) is skipped without counting or alerting.
      if (sizes[pool] === 0) continue;
      if (await this.takeBudget(smsBudgetKey(pool, day), sizes[pool], { channel: 'sms', pool, day })) return pool;
    }
    return null;
  }

  /**
   * One INCR per message on the pool's key for the IST day. Exactly one
   * request sees the 80 % value and exactly one the first over-budget value,
   * so each alert fires once a day per pool however many instances run.
   */
  private async takeBudget(key: string, budget: number, scope: { channel: 'sms' | 'email'; pool?: SmsBudgetPool; day: string }): Promise<boolean> {
    const [[incrErr, used]] = (await this.redis.multi().incr(key).expire(key, BUDGET_KEY_TTL_SECONDS).exec()) as [
      [Error | null, number],
      [Error | null, number],
    ];
    if (incrErr) throw incrErr;
    const kinds =
      scope.channel === 'sms'
        ? ({ warning: 'sms_budget_warning', exhausted: 'sms_budget_exhausted' } as const)
        : ({ warning: 'email_budget_warning', exhausted: 'email_budget_exhausted' } as const);
    const pool = scope.pool ? { pool: scope.pool } : {};
    if (used === Math.ceil(budget * BUDGET_WARNING_RATIO) && used <= budget) {
      await this.alerts.send({ kind: kinds.warning, used, budget, day: scope.day, ...pool });
    }
    if (used <= budget) return true;
    if (used === budget + 1) await this.alerts.send({ kind: kinds.exhausted, used: budget, budget, day: scope.day, ...pool });
    return false;
  }

  private echo(delivery: OtpDelivery): void {
    if (!this.config.getOrThrow<OtpConfig>('otp').devEcho) return;
    process.stdout.write(`[DEV ONLY] OTP for ${maskIdentifier(delivery.type, delivery.identifier)}: ${delivery.otp}\n`);
  }
}
