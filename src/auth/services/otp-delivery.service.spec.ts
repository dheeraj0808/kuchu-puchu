import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';

import { FakeAlertProvider } from '../../infra/alerts/fake-alert.provider';
import { FakeEmailProvider } from '../../infra/email/fake-email.provider';
import { FakeSmsProvider } from '../../infra/sms/fake-sms.provider';
import { IdentifierType, OtpPurpose } from '../models/otp-verification.model';
import { TEST_OTP_CONFIG } from '../testing/test-config';
import { istDay, OtpDeliveryService, smsBudgetKey } from './otp-delivery.service';

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

function setup(dailyBudget = 10, allowed = ['+91']) {
  const sms = new FakeSmsProvider();
  const email = new FakeEmailProvider();
  const alerts = new FakeAlertProvider();
  const redis = fakeRedis();
  const config = new ConfigService({
    otp: { ...TEST_OTP_CONFIG, smsAllowedCountries: allowed },
    sms: { provider: 'fake', dailyBudget },
  });
  const service = new OtpDeliveryService(sms, email, alerts, redis as never, config);
  return { service, sms, email, alerts, redis };
}

const smsTo = (identifier: string) => ({ type: IdentifierType.Phone, identifier, otp: '123456', purpose: OtpPurpose.Login });

describe('OtpDeliveryService', () => {
  it('sends SMS to allowed countries and email to anyone', async () => {
    const s = setup();
    await expect(s.service.send(smsTo('+919812345678'))).resolves.toBe('sent');
    expect(s.sms.lastCodeFor('+919812345678')).toBe('123456');
    await expect(
      s.service.send({ type: IdentifierType.Email, identifier: 'jane@example.com', otp: '654321', purpose: OtpPurpose.Reauth }),
    ).resolves.toBe('sent');
    expect(s.email.lastTo('jane@example.com')?.text).toContain('654321');
  });

  it('country allowlist: other calling codes are not sent and use no budget', async () => {
    const s = setup();
    await expect(s.service.send(smsTo('+14155550123'))).resolves.toBe('country_blocked');
    expect(s.sms.sent).toHaveLength(0);
    expect(s.redis.counters.size).toBe(0);
  });

  it('daily budget per IST date: one warning at 80 %, stop + one alert past 100 %', async () => {
    const s = setup(10);
    const outcomes: string[] = [];
    for (let i = 0; i < 13; i++) outcomes.push(await s.service.send(smsTo('+919812345678')));
    expect(outcomes.filter((o) => o === 'sent')).toHaveLength(10);
    expect(outcomes.slice(10)).toEqual(['budget_blocked', 'budget_blocked', 'budget_blocked']);
    expect(s.sms.sent).toHaveLength(10);
    const day = istDay();
    expect(s.alerts.sent).toEqual([
      { kind: 'sms_budget_warning', used: 8, budget: 10, day },
      { kind: 'sms_budget_exhausted', used: 10, budget: 10, day },
    ]);
    expect([...s.redis.counters.keys()]).toEqual([smsBudgetKey(day)]);
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
