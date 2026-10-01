import { createEmailProvider } from '../email/email.module';
import { FakeEmailProvider } from '../email/fake-email.provider';
import { SesEmailProvider } from '../email/ses-email.provider';
import { FakeSmsProvider } from './fake-sms.provider';
import { createSmsProvider } from './sms.module';

const sms = { apiKey: undefined, senderId: undefined, dltTemplateId: undefined, dailyBudget: 10 };

describe('messaging adapters', () => {
  it('SMS: only the fake exists; any other provider name fails at boot', () => {
    expect(createSmsProvider({ ...sms, provider: 'fake' })).toBeInstanceOf(FakeSmsProvider);
    expect(() => createSmsProvider({ ...sms, provider: 'dlt-sms' })).toThrow('not available yet');
  });

  it('email: SES when EMAIL_FROM and SES_REGION are set, else the fake', () => {
    expect(createEmailProvider({ from: 'a@b.co', sesRegion: 'ap-south-1' })).toBeInstanceOf(SesEmailProvider);
    expect(createEmailProvider({ from: undefined, sesRegion: 'ap-south-1' })).toBeInstanceOf(FakeEmailProvider);
  });

  it('SES sends one SendEmailCommand to the recipient, with the text body', async () => {
    const send = jest.fn().mockResolvedValue({});
    const provider = new SesEmailProvider('ap-south-1', 'no-reply@x.co', { send } as never);
    await provider.send({ to: 'jane@example.com', subject: 'S', text: 'T' });
    const input = send.mock.calls[0][0].input;
    expect(input).toMatchObject({
      FromEmailAddress: 'no-reply@x.co',
      Destination: { ToAddresses: ['jane@example.com'] },
      Content: { Simple: { Subject: { Data: 'S' }, Body: { Text: { Data: 'T' } } } },
    });
  });

  it('fakes keep only the newest 50 messages and can be told to fail', async () => {
    const fake = new FakeSmsProvider();
    for (let i = 0; i < 60; i++) await fake.sendOtp({ to: `+9198000000${String(i).padStart(2, '0')}`, code: String(i), expiresInMinutes: 5 });
    expect(fake.sent).toHaveLength(50);
    expect(fake.lastCodeFor('+919800000059')).toBe('59');
    fake.failWith = new Error('down');
    await expect(fake.sendOtp({ to: '+919800000000', code: '1', expiresInMinutes: 5 })).rejects.toThrow('down');
  });
});
