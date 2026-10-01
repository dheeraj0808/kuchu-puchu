import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';

import { FakeAlertProvider } from '../../infra/alerts/fake-alert.provider';
import { FakeEmailProvider } from '../../infra/email/fake-email.provider';
import { FakeSmsProvider } from '../../infra/sms/fake-sms.provider';
import { IdentifierType, OtpPurpose } from '../models/otp-verification.model';
import { TEST_OTP_CONFIG } from '../testing/test-config';
import { emailBudgetKey, istDay, OtpDeliveryService, smsBudgetKey, smsPoolSizes } from './otp-delivery.service';

/** A Redis stand-in for MULTI INCR/EXPIRE on one counter. */
function fakeRedis() {
  const counters = new Map<string, number>();
  return {
    counters,
    multi() {
      const ops: Array<() => [null, number]> = [];
      const chain = {
        incr(key: string) {
          ops.push(() => {
            counters.set(key, (counters.get(key) ?? 0) + 1);
            return [null, counters.get(key) as number];
          });
          return chain;
        },
        expire() {
          ops.push(() => [null, 1]);
          return chain;
        },
        exec: async () => ops.map((op) => op()),
      };
      return chain;
    },
  };
}

function setup(dailyBudget = 10, allowed = ['+91'], newIdentifierPercent = 70, emailBudget = 10) {
  const sms = new FakeSmsProvider();
  const email = new FakeEmailProvider();
  const alerts = new FakeAlertProvider();
  const redis = fakeRedis();
  const config = new ConfigService({
    otp: { ...TEST_OTP_CONFIG, smsAllowedCountries: allowed },
    sms: { provider: 'fake', dailyBudget, newIdentifierPercent },
    email: { from: undefined, sesRegion: undefined, dailyBudget: emailBudget },
  });
  const service = new OtpDeliveryService(sms, email, alerts, redis as never, config);
  return { service, sms, email, alerts, redis };
}

const smsTo = (identifier: string, existingAccount = false) => ({
  type: IdentifierType.Phone,
  identifier,
  otp: '123456',
  purpose: OtpPurpose.Login,
  existingAccount,
});
const emailTo = (identifier: string) => ({ type: IdentifierType.Email, identifier, otp: '654321', purpose: OtpPurpose.Login, existingAccount: false });

describe('OtpDeliveryService', () => {
  it('sends SMS to allowed countries and email to anyone', async () => {
    const s = setup();
    await expect(s.service.send(smsTo('+919812345678'))).resolves.toEqual({ status: 'sent', pool: 'new' });
    expect(s.sms.lastCodeFor('+919812345678')).toBe('123456');
    await expect(
      s.service.send({ type: IdentifierType.Email, identifier: 'jane@example.com', otp: '654321', purpose: OtpPurpose.Reauth, existingAccount: true }),
    ).resolves.toEqual({ status: 'sent' });
    expect(s.email.lastTo('jane@example.com')?.text).toContain('654321');
  });

  it('country allowlist: other calling codes are not sent and use no budget', async () => {
    const s = setup();
    await expect(s.service.send(smsTo('+14155550123'))).resolves.toEqual({ status: 'country_blocked' });
    expect(s.sms.sent).toHaveLength(0);
    expect(s.redis.counters.size).toBe(0);
  });

  it('pool sizes: SMS_BUDGET_NEW_IDENTIFIER_PERCENT of the budget for new identifiers, the rest reserved', () => {
    expect(smsPoolSizes({ dailyBudget: 10_000, newIdentifierPercent: 70 })).toEqual({ new: 7000, existing: 3000 });
    expect(smsPoolSizes({ dailyBudget: 10, newIdentifierPercent: 75 })).toEqual({ new: 7, existing: 3 });
    expect(smsPoolSizes({ dailyBudget: 10, newIdentifierPercent: 100 })).toEqual({ new: 10, existing: 0 });
  });

  it('new identifiers: their pool only; one warning at 80 %, stop + one alert past 100 %', async () => {
    const s = setup(20, ['+91'], 50); // 10 new, 10 reserved
    const outcomes: string[] = [];
    for (let i = 0; i < 13; i++) outcomes.push((await s.service.send(smsTo('+919812345678'))).status);
    expect(outcomes.filter((o) => o === 'sent')).toHaveLength(10);
    expect(outcomes.slice(10)).toEqual(['budget_blocked', 'budget_blocked', 'budget_blocked']);
    const day = istDay();
    expect(s.alerts.sent).toEqual([
      { kind: 'sms_budget_warning', used: 8, budget: 10, day, pool: 'new' },
      { kind: 'sms_budget_exhausted', used: 10, budget: 10, day, pool: 'new' },
    ]);
    // The reserve was never touched.
    expect([...s.redis.counters.keys()]).toEqual([smsBudgetKey('new', day)]);
  });

  it('an exhausted new-identifier pool never blocks existing accounts (they use the reserve)', async () => {
    const s = setup(20, ['+91'], 50);
    for (let i = 0; i < 12; i++) await s.service.send(smsTo('+919812345678'));
    await expect(s.service.send(smsTo('+919800000001', true))).resolves.toEqual({ status: 'sent', pool: 'existing' });
    expect(s.sms.lastCodeFor('+919800000001')).toBe('123456');
  });

  it('existing accounts fall back to the new pool when the reserve is used up; alerts per pool', async () => {
    const s = setup(10, ['+91'], 70); // 7 new, 3 reserved
    const pools: Array<string | undefined> = [];
    for (let i = 0; i < 11; i++) {
      const outcome = await s.service.send(smsTo('+919800000001', true));
      pools.push(outcome.status === 'sent' ? outcome.pool : outcome.status);
    }
    expect(pools).toEqual(['existing', 'existing', 'existing', 'new', 'new', 'new', 'new', 'new', 'new', 'new', 'budget_blocked']);
    const day = istDay();
    expect(s.alerts.sent).toEqual([
      { kind: 'sms_budget_warning', used: 3, budget: 3, day, pool: 'existing' },
      { kind: 'sms_budget_exhausted', used: 3, budget: 3, day, pool: 'existing' },
      { kind: 'sms_budget_warning', used: 6, budget: 7, day, pool: 'new' },
      { kind: 'sms_budget_exhausted', used: 7, budget: 7, day, pool: 'new' },
    ]);
  });

  it('a 0 % new-identifier share sends nothing to new identifiers, without alerts', async () => {
    const s = setup(10, ['+91'], 0);
    await expect(s.service.send(smsTo('+919812345678'))).resolves.toEqual({ status: 'budget_blocked', pool: 'new' });
    await expect(s.service.send(smsTo('+919800000001', true))).resolves.toEqual({ status: 'sent', pool: 'existing' });
    expect(s.alerts.sent).toEqual([]);
  });

  it('email budget per IST date: one warning at 80 %, stop + one alert past 100 %; not sent once used up', async () => {
    const s = setup(10, ['+91'], 70, 5);
    const outcomes: string[] = [];
    for (let i = 0; i < 7; i++) outcomes.push((await s.service.send(emailTo(`u${i}@example.com`))).status);
    expect(outcomes).toEqual(['sent', 'sent', 'sent', 'sent', 'sent', 'budget_blocked', 'budget_blocked']);
    expect(s.email.lastTo('u5@example.com')).toBeUndefined();
    const day = istDay();
    expect(s.alerts.sent).toEqual([
      { kind: 'email_budget_warning', used: 4, budget: 5, day },
      { kind: 'email_budget_exhausted', used: 5, budget: 5, day },
    ]);
    expect([...s.redis.counters.keys()]).toEqual([emailBudgetKey(day)]);
  });

  it('istDay turns at IST midnight (18:30 UTC)', () => {
    expect(istDay(new Date('2026-10-01T18:29:59Z'))).toBe('2026-10-01');
    expect(istDay(new Date('2026-10-01T18:30:00Z'))).toBe('2026-10-02');
  });

  it('adapter failures reject (the caller answers 503)', async () => {
    const s = setup();
    s.sms.failWith = new Error('down');
    await expect(s.service.send(smsTo('+919812345678'))).rejects.toThrow('down');
  });
});
