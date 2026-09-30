import { calculateAge, parseIsoDate } from './age.util';

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
