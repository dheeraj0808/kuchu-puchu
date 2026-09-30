import { IdentifierType } from '../models/otp-verification.model';

/** j***@example.com */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local[0]}***@${domain}`;
}

/** +91******3210 */
export function maskPhone(phone: string): string {
  if (phone.length <= 7) return '*'.repeat(phone.length);
  const prefix = phone.slice(0, 3);
  const suffix = phone.slice(-4);
  return `${prefix}${'*'.repeat(phone.length - 7)}${suffix}`;
}

export function maskIdentifier(type: IdentifierType, identifier: string): string {
  return type === IdentifierType.Email ? maskEmail(identifier) : maskPhone(identifier);
}
