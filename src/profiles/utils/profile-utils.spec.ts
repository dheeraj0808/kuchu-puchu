import { calculateAge, parseIsoDate } from './age.util';
import { sanitizeText } from './sanitize.util';

describe('age util', () => {
  const now = new Date('2026-09-30T12:00:00Z');

  it('calculates whole years, accounting for birthday not yet reached', () => {
    expect(calculateAge('2000-09-30', now)).toBe(26);
    expect(calculateAge('2000-10-01', now)).toBe(25);
    expect(calculateAge('2008-09-30', now)).toBe(18);
    expect(calculateAge('2008-10-01', now)).toBe(17);
  });

  it('rejects impossible calendar dates and bad formats', () => {
    expect(parseIsoDate('2001-02-29')).toBeNull();
    expect(parseIsoDate('2000-13-01')).toBeNull();
    expect(parseIsoDate('21/04/1998')).toBeNull();
    expect(parseIsoDate('2000-02-29')).not.toBeNull();
  });
});

describe('sanitizeText', () => {
  it('strips control, zero-width and bidi-override characters', () => {
    expect(sanitizeText('Pri​ya‮\u0007')).toBe('Priya');
  });

  it('collapses whitespace on single-line text', () => {
    expect(sanitizeText('  Software \n\t engineer  ')).toBe('Software engineer');
  });

  it('keeps limited line breaks for multiline text', () => {
    expect(sanitizeText('Hi  there\r\n\r\n\r\n\r\nBye ', true)).toBe('Hi there\n\nBye');
  });
});
