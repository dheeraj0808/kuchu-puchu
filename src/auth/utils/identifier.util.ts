import { parsePhoneNumberFromString } from 'libphonenumber-js';

import { AppException, ErrorCode } from '../../common/exceptions/app.exception';
import { IdentifierType } from '../models/otp-verification.model';

export const E164_REGEX = /^\+[1-9]\d{7,14}$/;

/** Numbers without a country code are read as Indian (guide M04). */
export const DEFAULT_PHONE_REGION = 'IN';

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * E.164 (e.g. +919812345678) for any valid form: "+91 98123 45678",
 * "098123-45678", "9812345678". Returns null for anything that is not a valid
 * number.
 */
export function toE164(value: string): string | null {
  const parsed = parsePhoneNumberFromString(value.trim(), DEFAULT_PHONE_REGION);
  if (!parsed || !parsed.isValid()) return null;
  return E164_REGEX.test(parsed.number) ? parsed.number : null;
}

/** For DTO transforms: E.164 when valid, else the trimmed input (the validator then rejects it). */
export function normalizePhone(value: string): string {
  return toE164(value) ?? value.trim();
}

export function normalizeIdentifier(type: IdentifierType, value: string): string {
  return type === IdentifierType.Email ? normalizeEmail(value) : normalizePhone(value);
}

/**
 * Normalises before a lookup or insert (guide M04). Throws 400
 * VALIDATION_ERROR for a phone that is not a valid number. Idempotent.
 */
export function normalizeIdentifierStrict(type: IdentifierType, value: string): string {
  if (type === IdentifierType.Email) return normalizeEmail(value);
  const e164 = toE164(value);
  if (!e164) {
    throw new AppException(ErrorCode.ValidationError, {
      errors: [{ field: 'identifier', message: 'identifier must be a valid phone number' }],
    });
  }
  return e164;
}

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * The form used for rate limits and ban checks only; the stored email is never
 * changed. Lower-cased, "+tag" removed on every domain, and for Gmail the dots
 * removed and googlemail.com read as gmail.com, so aliases of one mailbox share
 * one cooldown, one set of caps and one ban entry.
 */
export function canonicalEmail(value: string): string {
  const email = normalizeEmail(value);
  const at = email.lastIndexOf('@');
  if (at <= 0) return email;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}

/** Canonical form of a normalised identifier (phones are already canonical as E.164). */
export function canonicalIdentifier(type: IdentifierType, normalizedIdentifier: string): string {
  return type === IdentifierType.Email ? canonicalEmail(normalizedIdentifier) : normalizedIdentifier;
}
