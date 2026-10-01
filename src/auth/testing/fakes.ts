import { randomUUID } from 'node:crypto';

import type { SecurityEventsService } from '../../security/security-events.service';
import { type User, UserRole, UserStatus } from '../../users/models/user.model';
import type { Session } from '../models/session.model';

export function fakeUser(overrides: Partial<User> = {}): User {
  const base = {
    id: randomUUID(),
    email: 'jane@example.com',
    phone: null,
    emailVerifiedAt: new Date(),
    phoneVerifiedAt: null,
    status: UserStatus.Active,
    role: UserRole.User,
    deletedAt: null,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
  return {
    ...base,
    canAuthenticate(this: Pick<User, 'status' | 'deletedAt'>): boolean {
      return this.status === UserStatus.Active && !this.deletedAt;
    },
    save: jest.fn().mockResolvedValue(undefined),
  } as unknown as User;
}

export function fakeSession(overrides: Partial<Session> = {}): Session {
  const s = {
    id: randomUUID(),
    userId: randomUUID(),
    refreshTokenHash: 'a'.repeat(64),
    previousRefreshTokenHash: null,
    deviceId: null,
    deviceName: null,
    ipAddress: null,
    userAgent: null,
    lastUsedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  } as Record<string, unknown>;
  s.isUsable = (now: Date = new Date()): boolean =>
    !s.revokedAt && (s.expiresAt as Date).getTime() > now.getTime();
  s.set = (changes: Record<string, unknown>): void => {
    Object.assign(s, changes);
  };
  return s as unknown as Session;
}

export function fakeSecurityEvents(): SecurityEventsService & { record: jest.Mock } {
  return {
    record: jest.fn().mockResolvedValue(undefined),
    hashIdentifier: (type: string, value: string) => `h:${type}:${value}`.slice(0, 12),
  } as unknown as SecurityEventsService & {
    record: jest.Mock;
  };
}

/** A SessionStateService stand-in that derives the cached state from a session lookup. */
export function fakeSessionState(
  find: (sessionId: string) => Promise<Session | null>,
): { get: jest.Mock; takeRestrictionAuditSlot: jest.Mock } {
  return {
    takeRestrictionAuditSlot: jest.fn().mockResolvedValue(true),
    get: jest.fn(async (sessionId: string) => {
      const s = await find(sessionId);
      if (!s || !s.user) return null;
      return {
        userId: s.userId,
        role: s.user.role,
        status: s.user.status,
        deleted: Boolean(s.user.deletedAt),
        revoked: Boolean(s.revokedAt),
        expiresAt: new Date(s.expiresAt).getTime(),
      };
    }),
  };
}
