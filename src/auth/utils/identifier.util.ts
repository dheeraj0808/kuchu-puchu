import { IdentifierType } from '../models/otp-verification.model';

export const E164_REGEX = /^\+[1-9]\d{7,14}$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string): string {
  return value.trim().replace(/[\s\-().]/g, '');
}

export function normalizeIdentifier(type: IdentifierType, value: string): string {
  return type === IdentifierType.Email ? normalizeEmail(value) : normalizePhone(value);
}
