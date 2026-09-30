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
    isActive: true,
    isBanned: false,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
  return {
    ...base,
    canAuthenticate(this: Pick<User, 'isActive' | 'isBanned' | 'status'>): boolean {
      return this.isActive && !this.isBanned && this.status === UserStatus.Active;
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
  return { record: jest.fn().mockResolvedValue(undefined) } as unknown as SecurityEventsService & {
    record: jest.Mock;
  };
}
