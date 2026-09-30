// C0/C1 control chars except \n and \t, plus zero-width and bidi-override characters
// commonly used for spoofing or hiding content.
// oxlint-disable-next-line no-control-regex -- intentionally strips control characters
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const INVISIBLE_CHARS = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/**
 * Normalizes free text: NFC, strips control/invisible characters, collapses whitespace.
 * Multiline keeps single line breaks (max two in a row).
 */
export function sanitizeText(value: string, multiline = false): string {
  let out = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').replace(INVISIBLE_CHARS, '');
  if (multiline) {
    out = out
      .split('\n')
      .map((line) => line.replace(/[\t ]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  } else {
    out = out.replace(/\s+/g, ' ');
  }
  return out.trim();
}
