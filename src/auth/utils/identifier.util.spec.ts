import { ErrorCode } from '../../common/exceptions/app.exception';
import { IdentifierType } from '../models/otp-verification.model';
import { normalizeIdentifierStrict, normalizePhone, toE164 } from './identifier.util';

describe('identifier normalisation', () => {
  it.each(['+919812345678', '+91 98123 45678', '9812345678', '09812345678', '098123-45678', ' (+91) 98123 45678 ', '0091 9812345678'])(
    'maps %p to +919812345678',
    (input) => {
      expect(toE164(input)).toBe('+919812345678');
      expect(normalizeIdentifierStrict(IdentifierType.Phone, input)).toBe('+919812345678');
    },
  );

  it('keeps other countries in E.164', () => {
    expect(toE164('+44 20 7946 0958')).toBe('+442079460958');
  });

  it.each(['12345', '+910000000000', 'not a phone', '', '+1 555'])('rejects %p with 400 VALIDATION_ERROR', (input) => {
    expect(toE164(input)).toBeNull();
    expect(() => normalizeIdentifierStrict(IdentifierType.Phone, input)).toThrow(
      expect.objectContaining({ code: ErrorCode.ValidationError }),
    );
    expect(normalizePhone(input)).toBe(input.trim());
  });

  it('trims and lower-cases email', () => {
    expect(normalizeIdentifierStrict(IdentifierType.Email, '  Jane.Doe@Example.COM ')).toBe('jane.doe@example.com');
  });
});
