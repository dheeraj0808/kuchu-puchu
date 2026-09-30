import { sanitizeText } from './sanitize';

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
