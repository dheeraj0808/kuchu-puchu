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

/**
 * Hides the host part of an IP for device lists (guide M06): IPv4 keeps three
 * octets ("203.0.113.*"), IPv6 keeps the /48 prefix ("2001:db8:85a3:*").
 * IPv4-mapped IPv6 addresses are shown as IPv4.
 */
export function maskIp(ip: string): string {
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.*`;
  if (ip.includes(':')) {
    const head = ip.split('::')[0].split(':').filter(Boolean).slice(0, 3);
    return head.length > 0 ? `${head.join(':')}:*` : '*';
  }
  return '*';
}
