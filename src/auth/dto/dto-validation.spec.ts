import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { IdentifierType } from '../models/otp-verification.model';
import { RequestOtpDto } from './request-otp.dto';
import { VerifyOtpDto } from './verify-otp.dto';

function check<T extends object>(cls: new () => T, plain: Record<string, unknown>): { dto: T; ok: boolean } {
  const dto = plainToInstance(cls, plain);
  return { dto, ok: validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length === 0 };
}

describe('auth DTOs', () => {
  it('normalizes email', () => {
    const { dto, ok } = check(RequestOtpDto, { identifierType: 'email', identifier: '  Jane@Example.COM ' });
    expect(ok).toBe(true);
    expect(dto.identifier).toBe('jane@example.com');
  });

  it('normalizes phone and enforces E.164', () => {
    const good = check(RequestOtpDto, { identifierType: 'phone', identifier: '+91 98765-43210' });
    expect(good.ok).toBe(true);
    expect(good.dto.identifier).toBe('+919876543210');
    expect(check(RequestOtpDto, { identifierType: 'phone', identifier: '9876543210' }).ok).toBe(false);
    expect(check(RequestOtpDto, { identifierType: 'phone', identifier: 'jane@example.com' }).ok).toBe(false);
  });

  it('rejects email in phone-shaped slot and bad types', () => {
    expect(check(RequestOtpDto, { identifierType: 'email', identifier: '+919876543210' }).ok).toBe(false);
    expect(check(RequestOtpDto, { identifierType: 'fax', identifier: 'x@y.com' }).ok).toBe(false);
    expect(check(RequestOtpDto, { identifierType: 'email', identifier: 'x@y.com', extra: 1 }).ok).toBe(false);
  });

  it('validates verify dto', () => {
    const base = { identifierType: IdentifierType.Email, identifier: 'jane@example.com' };
    expect(check(VerifyOtpDto, { ...base, otp: '012345', deviceId: 'ios-1:A.b_c' }).ok).toBe(true);
    expect(check(VerifyOtpDto, { ...base, otp: '12ab56' }).ok).toBe(false);
    expect(check(VerifyOtpDto, { ...base, otp: '123' }).ok).toBe(false);
    expect(check(VerifyOtpDto, { ...base, otp: '123456', deviceId: 'bad id!' }).ok).toBe(false);
  });
});
