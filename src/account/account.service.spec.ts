import 'reflect-metadata';

import type { Sequelize } from 'sequelize-typescript';

import { IdentifierType } from '../auth/models/otp-verification.model';
import type { OtpService } from '../auth/services/otp.service';
import type { SessionService } from '../auth/services/session.service';
import { fakeSecurityEvents, fakeUser } from '../auth/testing/fakes';
import { AppException } from '../common/exceptions/app.exception';
import { createTestConfig } from '../auth/testing/test-config';
import { InterestsService } from '../interests/interests.service';
import type { Interest } from '../interests/models/interest.model';
import type { ProfileInterest } from '../interests/models/profile-interest.model';
import type { PreferencesService } from '../preferences/preferences.service';
import type { Profile } from '../profiles/models/profile.model';
import { ProfileCompletionService } from '../profiles/profile-completion.service';
import { ProfilesService } from '../profiles/profiles.service';
import { fakeProfile } from '../profiles/testing/fakes';
import { SecurityEventType } from '../security/models/security-event.model';
import { UserRole } from '../users/models/user.model';
import type { UsersService } from '../users/users.service';
import { AccountService } from './account.service';

const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest' };

function setup(user = fakeUser({ email: 'jane@example.com', phone: '+919876543210' })) {
  const tx = { id: 'tx', LOCK: { UPDATE: 'UPDATE' } };
  const order: string[] = [];
  const users = {
    findByIdForUpdate: jest.fn().mockResolvedValue(user),
    anonymizeAndSoftDelete: jest.fn(() => {
      order.push('user');
      return Promise.resolve();
    }),
  };
  const sessions = {
    revokeAllForUser: jest.fn(() => {
      order.push('sessions');
      return Promise.resolve(3);
    }),
  };
  const profiles = {
    deactivateForAccountDeletion: jest.fn(() => {
      order.push('profile');
      return Promise.resolve(true);
    }),
  };
  const preferences = {
    deleteForUser: jest.fn(() => {
      order.push('preferences');
      return Promise.resolve(1);
    }),
  };
  const otp = { hashIdentifier: jest.fn((t: IdentifierType, v: string) => `hash(${t}:${v.length})`) };
  const events = fakeSecurityEvents();
  const sequelize = { transaction: jest.fn((fn: (t: object) => Promise<unknown>) => fn(tx)) };
  const service = new AccountService(
    users as unknown as UsersService,
    sessions as unknown as SessionService,
    profiles as unknown as ProfilesService,
    otp as unknown as OtpService,
    events,
    sequelize as unknown as Sequelize,
    preferences as unknown as PreferencesService,
  );
  return { service, user, users, sessions, profiles, preferences, otp, events, tx, order, sequelize };
}

function event0(events: { record: jest.Mock }): unknown {
  return (events.record.mock.calls[0] as unknown[])[0];
}

describe('AccountService.deleteAccount', () => {
  const principal = (id: string) => ({ userId: id, sessionId: 's', role: UserRole.User });

  it('revokes sessions, deactivates the profile and anonymizes the user in one transaction', async () => {
    const { service, user, users, sessions, profiles, preferences, tx, order, sequelize } = setup();
    await service.deleteAccount(principal(user.id), ctx);

    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
    expect(users.findByIdForUpdate).toHaveBeenCalledWith(user.id, tx);
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(user.id, 'account_deleted', tx);
    expect(preferences.deleteForUser).toHaveBeenCalledWith(user.id, tx);
    expect(profiles.deactivateForAccountDeletion).toHaveBeenCalledWith(user.id, tx);
    expect(users.anonymizeAndSoftDelete).toHaveBeenCalledWith(user, tx);
    expect(order).toEqual(['sessions', 'preferences', 'profile', 'user']);
  });

  it('records an audit event with hashed identifiers only (never raw PII)', async () => {
    const { service, user, events, otp, tx } = setup();
    await service.deleteAccount(principal(user.id), ctx);

    void otp;
    expect((event0(events) as { metadata: { identifierHashPrefixes: string[] } }).metadata.identifierHashPrefixes).toEqual([
      'h:email:jane',
      'h:phone:+919',
    ]);
    const [[event]] = events.record.mock.calls as [[{ eventType: string; metadata: unknown; transaction: unknown }]];
    expect(event.eventType).toBe(SecurityEventType.AccountDeleted);
    expect(event.transaction).toBe(tx);
    const serialized = JSON.stringify(event.metadata);
    expect(serialized).not.toContain('jane@example.com');
    expect(serialized).not.toContain('9876543210');
    expect(event.metadata).toEqual(expect.objectContaining({ revokedSessions: 3, preferencesDeleted: true, profileDeactivated: true }),
    );
  });

  it('reports preferencesDeleted=false when the user had none', async () => {
    const { service, user, preferences, events } = setup();
    preferences.deleteForUser.mockResolvedValue(0);
    await service.deleteAccount(principal(user.id), ctx);
    const [[event]] = events.record.mock.calls as [[{ metadata: Record<string, unknown> }]];
    expect(event.metadata.preferencesDeleted).toBe(false);
  });

  it('rejects when the user no longer exists and changes nothing', async () => {
    const { service, users, sessions } = setup();
    users.findByIdForUpdate.mockResolvedValue(null);
    await expect(service.deleteAccount(principal('missing'), ctx)).rejects.toBeInstanceOf(AppException);
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('removes preferences and profile interests, never the global interest catalogue', async () => {
    const user = fakeUser();
    const tx = { id: 'tx', LOCK: { UPDATE: 'UPDATE' } };
    const profile = fakeProfile({ userId: user.id });
    const profileModel = { findOne: jest.fn().mockResolvedValue(profile) };
    const profileInterestModel = { destroy: jest.fn().mockResolvedValue(4) };
    const interestModel = { destroy: jest.fn(), update: jest.fn() };
    const interests = new InterestsService(
      interestModel as unknown as typeof Interest,
      profileInterestModel as unknown as typeof ProfileInterest,
      createTestConfig(),
    );
    const removeAll = jest.spyOn(interests, 'removeAllForProfile');
    const sequelize = { transaction: jest.fn((fn: (t: object) => Promise<unknown>) => fn(tx)) };
    const realProfiles = new ProfilesService(
      profileModel as unknown as typeof Profile,
      new ProfileCompletionService(),
      fakeSecurityEvents(),
      sequelize as unknown as Sequelize,
      interests,
      {} as PreferencesService,
    );
    const preferences = { deleteForUser: jest.fn().mockResolvedValue(1) };
    const service = new AccountService(
      {
        findByIdForUpdate: jest.fn().mockResolvedValue(user),
        anonymizeAndSoftDelete: jest.fn().mockResolvedValue(undefined),
      } as unknown as UsersService,
      { revokeAllForUser: jest.fn().mockResolvedValue(0) } as unknown as SessionService,
      realProfiles,
      { hashIdentifier: jest.fn(() => 'h') } as unknown as OtpService,
      fakeSecurityEvents(),
      sequelize as unknown as Sequelize,
      preferences as unknown as PreferencesService,
    );

    await service.deleteAccount(principal(user.id), ctx);

    expect(preferences.deleteForUser).toHaveBeenCalledWith(user.id, tx);
    expect(removeAll).toHaveBeenCalledWith(profile.id, tx);
    expect(profileInterestModel.destroy).toHaveBeenCalledTimes(1);
    expect(profileInterestModel.destroy).toHaveBeenCalledWith({ where: { profileId: profile.id }, transaction: tx });
    expect(interestModel.destroy).not.toHaveBeenCalled();
    expect(interestModel.update).not.toHaveBeenCalled();
    expect(profile.destroy).toHaveBeenCalledWith({ transaction: tx });
  });

  it('propagates failures so the transaction rolls back', async () => {
    const { service, user, profiles, users } = setup();
    profiles.deactivateForAccountDeletion.mockRejectedValue(new Error('db down'));
    await expect(service.deleteAccount(principal(user.id), ctx)).rejects.toThrow('db down');
    expect(users.anonymizeAndSoftDelete).not.toHaveBeenCalled();
  });
});
