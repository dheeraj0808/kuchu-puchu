import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { OtpRequestDto } from './otp-request.dto';
import { OtpVerifyDto } from './otp-verify.dto';
import { ReauthRequestDto, ReauthVerifyDto } from './reauth.dto';

function check<T extends object>(cls: new () => T, plain: Record<string, unknown>): { dto: T; ok: boolean } {
  const dto = plainToInstance(cls, plain);
  return { dto, ok: validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length === 0 };
}

const device = { deviceId: 'b1f0c6c2-4d5e:A.b_c', deviceName: "Jane's Pixel", platform: 'android', appVersion: '1.4.0+12' };

describe('auth DTOs', () => {
  it('normalizes email for channel email', () => {
    const { dto, ok } = check(OtpRequestDto, { channel: 'email', identifier: '  Jane@Example.COM ' });
    expect(ok).toBe(true);
    expect(dto.identifier).toBe('jane@example.com');
  });

  it('normalizes phone to E.164 (default region IN) for channel sms and rejects invalid numbers', () => {
    const good = check(OtpRequestDto, { channel: 'sms', identifier: '+91 98765-43210' });
    expect(good.ok).toBe(true);
    expect(good.dto.identifier).toBe('+919876543210');
    const local = check(OtpRequestDto, { channel: 'sms', identifier: '98765 43210' });
    expect(local.dto.identifier).toBe('+919876543210');
    expect(check(OtpRequestDto, { channel: 'sms', identifier: '12345' }).ok).toBe(false);
    expect(check(OtpRequestDto, { channel: 'sms', identifier: 'jane@example.com' }).ok).toBe(false);
  });

  it('rejects the old field names, bad channels and unknown fields', () => {
    expect(check(OtpRequestDto, { identifierType: 'email', identifier: 'x@y.com' }).ok).toBe(false);
    expect(check(OtpRequestDto, { channel: 'phone', identifier: '+919876543210' }).ok).toBe(false);
    expect(check(OtpRequestDto, { channel: 'email', identifier: '+919876543210' }).ok).toBe(false);
    expect(check(OtpRequestDto, { channel: 'email', identifier: 'x@y.com', extra: 1 }).ok).toBe(false);
  });

  it('verify needs the code and every device field', () => {
    const base = { channel: 'email', identifier: 'jane@example.com', otp: '012345' };
    expect(check(OtpVerifyDto, { ...base, ...device }).ok).toBe(true);
    for (const missing of Object.keys(device)) {
      const partial: Record<string, unknown> = { ...base, ...device };
      delete partial[missing];
      expect(check(OtpVerifyDto, partial).ok).toBe(false);
    }
    expect(check(OtpVerifyDto, { ...base, ...device, otp: '12ab56' }).ok).toBe(false);
    expect(check(OtpVerifyDto, { ...base, ...device, deviceId: 'bad id!' }).ok).toBe(false);
    expect(check(OtpVerifyDto, { ...base, ...device, deviceId: 'x'.repeat(101) }).ok).toBe(false);
    expect(check(OtpVerifyDto, { ...base, ...device, platform: 'web' }).ok).toBe(false);
    expect(check(OtpVerifyDto, { ...base, ...device, appVersion: 'x'.repeat(21) }).ok).toBe(false);
    expect(check(OtpVerifyDto, { ...base, ...device, deviceName: '   ' }).ok).toBe(false);
  });

  it('reauth bodies', () => {
    expect(check(ReauthRequestDto, {}).ok).toBe(true);
    expect(check(ReauthRequestDto, { channel: 'sms' }).ok).toBe(true);
    expect(check(ReauthRequestDto, { channel: 'fax' }).ok).toBe(false);
    expect(check(ReauthVerifyDto, { otp: '123456' }).ok).toBe(true);
    expect(check(ReauthVerifyDto, { code: '123456' }).ok).toBe(false);
  });
});
