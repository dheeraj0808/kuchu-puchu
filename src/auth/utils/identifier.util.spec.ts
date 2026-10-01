import { ErrorCode } from '../../common/exceptions/app.exception';
import { IdentifierType } from '../models/otp-verification.model';
import { canonicalEmail, canonicalIdentifier, normalizeIdentifierStrict, normalizePhone, toE164 } from './identifier.util';

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

describe('canonicalEmail (rate limits and ban checks only)', () => {
  it.each([
    ['Jane.Doe+dating@Gmail.com', 'janedoe@gmail.com'],
    ['j.a.n.e.doe@googlemail.com', 'janedoe@gmail.com'],
    ['janedoe@gmail.com', 'janedoe@gmail.com'],
    ['jane+work@example.com', 'jane@example.com'],
    ['jane.doe+a+b@example.com', 'jane.doe@example.com'],
    ['  JANE@Example.COM ', 'jane@example.com'],
    // A leading "+" is the whole local part, not a tag.
    ['+tag@example.com', '+tag@example.com'],
  ])('%s → %s', (input, expected) => {
    expect(canonicalEmail(input)).toBe(expected);
  });

  it('phones are already canonical (E.164)', () => {
    expect(canonicalIdentifier(IdentifierType.Phone, '+919812345678')).toBe('+919812345678');
    expect(canonicalIdentifier(IdentifierType.Email, 'a.b+c@gmail.com')).toBe('ab@gmail.com');
  });
});
