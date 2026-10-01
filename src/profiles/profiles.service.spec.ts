import 'reflect-metadata';

import { type Transaction, UniqueConstraintError } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import { fakeSecurityEvents } from '../auth/testing/fakes';
import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import type { InterestsService } from '../interests/interests.service';
import type { PreferencesService } from '../preferences/preferences.service';
import { SecurityEventType } from '../security/models/security-event.model';
import type { CreateProfileDto } from './dto/create-profile.dto';
import { Gender, type Profile, ProfileVisibility } from './models/profile.model';
import { ProfileCompletionService } from './profile-completion.service';
import { fakeSettings } from '../settings/testing/fake-settings';
import { ProfileCreationHooks } from './profile-creation-hooks';
import { ProfilesService } from './profiles.service';
import { type FakeProfile, fakeProfile } from './testing/fakes';

const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest' };
const USER_ID = '11111111-1111-4111-8111-111111111111';

const createDto = (over: Partial<CreateProfileDto> = {}): CreateProfileDto => ({
  displayName: 'Priya',
  dateOfBirth: '1998-04-21',
  gender: Gender.Woman,
  ...over,
});

const PREFS = { minAge: 18, maxAge: 99 };
const INTERESTS = [
  { id: 'i1', name: 'Art', slug: 'art' },
  { id: 'i2', name: 'Books', slug: 'books' },
  { id: 'i3', name: 'Music', slug: 'music' },
];

function setup() {
  const model = {
    findOne: jest.fn().mockResolvedValue(null),
    build: jest.fn((attrs: Partial<Profile>) => fakeProfile({ id: 'new-profile', ...attrs })),
  };
  const events = fakeSecurityEvents();
  const tx = { LOCK: { UPDATE: 'UPDATE' } };
  const sequelize = { transaction: jest.fn((fn: (t: object) => Promise<unknown>) => fn(tx)) };
  const interestsService = {
    countActiveForProfile: jest.fn().mockResolvedValue(0),
    listForProfile: jest.fn().mockResolvedValue([]),
    replaceForProfile: jest.fn((_profileId: string, ids: string[]) => Promise.resolve(ids.length)),
    removeAllForProfile: jest.fn().mockResolvedValue(0),
    maxInterests: jest.fn().mockResolvedValue(5),
  };
  const preferencesService = { getOwn: jest.fn().mockResolvedValue(PREFS) };
  const service = new ProfilesService(
    model as unknown as typeof Profile,
    new ProfileCompletionService(),
    events,
    sequelize as unknown as Sequelize,
    interestsService as unknown as InterestsService,
    preferencesService as unknown as PreferencesService,
    fakeSettings(),
    new ProfileCreationHooks(),
  );
  return { service, model, events, sequelize, tx, interestsService, preferencesService };
}

const expectAppError = async (p: Promise<unknown>, code: ErrorCode, status: number): Promise<void> => {
  await expect(p).rejects.toBeInstanceOf(AppException);
  await p.catch((e: AppException) => {
    expect(e.code).toBe(code);
    expect(e.getStatus()).toBe(status);
  });
};

describe('ProfilesService', () => {
  describe('create', () => {
    it('creates a profile for the caller with server-computed completion', async () => {
      const { service, model, events } = setup();
      const res = await service.create(USER_ID, createDto({ bio: 'Hello' }), ctx);

      expect(model.build).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }));
      const built = model.build.mock.results[0].value as FakeProfile;
      expect(built.save).toHaveBeenCalled();
      expect(built.profileCompletion).toBe(55);
      expect(res.profileCompletion).toBe(55);
      expect(res.missingFields).toEqual(['location', 'occupation', 'education', 'interests']);
      expect(res.age).toBeGreaterThanOrEqual(18);
      expect(events.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: SecurityEventType.ProfileCreated, userId: USER_ID }),
      );
    });

    it('rounds coordinates and never exposes them in the response', async () => {
      const { service, model } = setup();
      const res = await service.create(
        USER_ID,
        createDto({ location: { latitude: 12.971598, longitude: 77.594566, city: 'Bengaluru', country: 'IN' } }),
        ctx,
      );
      const built = model.build.mock.results[0].value as FakeProfile;
      expect(built.latitude).toBe(12.972);
      expect(built.longitude).toBe(77.595);
      expect(built.locationUpdatedAt).toBeInstanceOf(Date);
      expect(res.location).toEqual(expect.objectContaining({ city: 'Bengaluru', country: 'IN', hasCoordinates: true }));
      expect(JSON.stringify(res)).not.toMatch(/latitude|longitude|12\.97|77\.59/);
      expect(res).not.toHaveProperty('userId');
    });

    it('rejects a second profile with 409', async () => {
      const { service, model } = setup();
      model.findOne.mockResolvedValue(fakeProfile({ userId: USER_ID }));
      await expectAppError(service.create(USER_ID, createDto(), ctx), ErrorCode.ProfileAlreadyExists, 409);
    });

    it('maps a concurrent unique-constraint violation to 409', async () => {
      const { service, model } = setup();
      model.build.mockImplementation((attrs: Partial<Profile>) => {
        const p = fakeProfile(attrs);
        p.save.mockRejectedValue(new UniqueConstraintError({}));
        return p;
      });
      await expectAppError(service.create(USER_ID, createDto(), ctx), ErrorCode.ProfileAlreadyExists, 409);
    });

    it('restores a previously deleted profile, keeping the locked DOB', async () => {
      const { service, model } = setup();
      const deleted = fakeProfile({ userId: USER_ID, deletedAt: new Date(), dateOfBirth: '1998-04-21' });
      model.findOne.mockResolvedValue(deleted);
      await service.create(USER_ID, createDto({ displayName: 'Asha' }), ctx);
      expect(deleted.restore).toHaveBeenCalled();
      expect(deleted.displayName).toBe('Asha');
      expect(deleted.deletedAt).toBeNull();
    });

    it('refuses to change DOB by deleting and re-creating', async () => {
      const { service, model } = setup();
      model.findOne.mockResolvedValue(fakeProfile({ userId: USER_ID, deletedAt: new Date(), dateOfBirth: '1998-04-21' }));
      await expectAppError(
        service.create(USER_ID, createDto({ dateOfBirth: '1990-01-01' }), ctx),
        ErrorCode.ProfileDobLocked,
        422,
      );
    });
  });

  describe('update', () => {
    it('applies only provided fields and recomputes completion', async () => {
      const { service, model } = setup();
      const profile = fakeProfile({ userId: USER_ID });
      model.findOne.mockResolvedValue(profile);

      const res = await service.update(USER_ID, { bio: 'New bio', location: { latitude: 10, longitude: 20 } });

      expect(profile.bio).toBe('New bio');
      expect(profile.displayName).toBe('Priya');
      expect(profile.profileCompletion).toBe(70);
      expect(profile.save).toHaveBeenCalled();
      expect(res.profileCompletion).toBe(70);
    });

    it('clears location and optional text with null', async () => {
      const { service, model } = setup();
      const profile = fakeProfile({ userId: USER_ID, bio: 'x', latitude: 1, longitude: 2, city: 'Pune' });
      model.findOne.mockResolvedValue(profile);
      await service.update(USER_ID, { bio: null, location: null });
      expect(profile.bio).toBeNull();
      expect(profile.latitude).toBeNull();
      expect(profile.city).toBeNull();
    });

    it('404 when the caller has no profile', async () => {
      const { service } = setup();
      await expectAppError(service.update(USER_ID, { bio: 'x' }), ErrorCode.ProfileNotFound, 404);
    });

    it('counts active interests towards completion', async () => {
      const { service, model, interestsService } = setup();
      const profile = fakeProfile({ userId: USER_ID });
      model.findOne.mockResolvedValue(profile);
      interestsService.countActiveForProfile.mockResolvedValue(3);
      const res = await service.update(USER_ID, { bio: 'x' });
      expect(interestsService.countActiveForProfile).toHaveBeenCalledWith(profile.id, undefined);
      expect(res.profileCompletion).toBe(75);
      expect(res.missingFields).not.toContain('interests');
    });
  });

  describe('getOwn', () => {
    it('returns interests and preferences, never coordinates', async () => {
      const { service, model, interestsService, preferencesService } = setup();
      const profile = fakeProfile({ userId: USER_ID, latitude: 12.972, longitude: 77.595, city: 'Pune' });
      model.findOne.mockResolvedValue(profile);
      interestsService.listForProfile.mockResolvedValue(INTERESTS);

      const res = await service.getOwn(USER_ID);

      expect(interestsService.listForProfile).toHaveBeenCalledWith(profile.id);
      expect(preferencesService.getOwn).toHaveBeenCalledWith(USER_ID);
      expect(res.interests).toEqual(INTERESTS);
      expect(res.preferences).toEqual(PREFS);
      expect(res.profileCompletion).toBe(75);
      expect(JSON.stringify(res)).not.toMatch(/latitude|longitude|12\.97|77\.59/);
      expect(res).not.toHaveProperty('userId');
    });

    it('404 when the caller has no profile', async () => {
      const { service } = setup();
      await expectAppError(service.getOwn(USER_ID), ErrorCode.ProfileNotFound, 404);
    });
  });

  describe('interests', () => {
    it('getOwnInterests returns [] before onboarding', async () => {
      const { service, interestsService } = setup();
      await expect(service.getOwnInterests(USER_ID)).resolves.toEqual({ interests: [], maxInterests: 5 });
      expect(interestsService.listForProfile).not.toHaveBeenCalled();
    });

    it('getOwnInterests lists the caller profile interests', async () => {
      const { service, model, interestsService } = setup();
      const profile = fakeProfile({ userId: USER_ID });
      model.findOne.mockResolvedValue(profile);
      interestsService.listForProfile.mockResolvedValue(INTERESTS);
      await expect(service.getOwnInterests(USER_ID)).resolves.toEqual({ interests: INTERESTS, maxInterests: 5 });
      expect(model.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: USER_ID } }));
      expect(interestsService.listForProfile).toHaveBeenCalledWith(profile.id);
    });

    it('replaceOwnInterests runs in a transaction with a row lock and refreshes completion', async () => {
      const { service, model, sequelize, tx, interestsService } = setup();
      const profile = fakeProfile({ userId: USER_ID, profileCompletion: 40 });
      model.findOne.mockResolvedValue(profile);
      interestsService.listForProfile.mockResolvedValue(INTERESTS);

      const res = await service.replaceOwnInterests(USER_ID, ['i1', 'i2', 'i3']);

      expect(sequelize.transaction).toHaveBeenCalledTimes(1);
      expect(model.findOne).toHaveBeenCalledWith({ where: { userId: USER_ID }, transaction: tx, lock: tx.LOCK.UPDATE });
      expect(interestsService.replaceForProfile).toHaveBeenCalledWith(profile.id, ['i1', 'i2', 'i3'], tx);
      expect(profile.profileCompletion).toBe(60);
      expect(profile.save).toHaveBeenCalledWith({ transaction: tx });
      expect(interestsService.listForProfile).toHaveBeenCalledWith(profile.id, tx);
      expect(res).toEqual({ interests: INTERESTS, maxInterests: 5 });
    });

    it('replaceOwnInterests with [] drops the interests share of completion', async () => {
      const { service, model, interestsService } = setup();
      const profile = fakeProfile({ userId: USER_ID, profileCompletion: 60 });
      model.findOne.mockResolvedValue(profile);
      await service.replaceOwnInterests(USER_ID, []);
      expect(interestsService.replaceForProfile).toHaveBeenCalledWith(profile.id, [], expect.anything());
      expect(profile.profileCompletion).toBe(40);
    });

    it('replaceOwnInterests 404s when the caller has no profile and changes nothing', async () => {
      const { service, interestsService } = setup();
      await expectAppError(service.replaceOwnInterests(USER_ID, ['i1']), ErrorCode.ProfileNotFound, 404);
      expect(interestsService.replaceForProfile).not.toHaveBeenCalled();
    });

    it('replaceOwnInterests propagates service validation errors without saving', async () => {
      const { service, model, interestsService } = setup();
      const profile = fakeProfile({ userId: USER_ID });
      model.findOne.mockResolvedValue(profile);
      interestsService.replaceForProfile.mockRejectedValue(
        new AppException(ErrorCode.InvalidInterests),
      );
      await expectAppError(service.replaceOwnInterests(USER_ID, ['x']), ErrorCode.InvalidInterests, 400);
      expect(profile.save).not.toHaveBeenCalled();
    });
  });

  describe('ownership', () => {
    it('always scopes lookups to the authenticated user id', async () => {
      const { service, model } = setup();
      model.findOne.mockResolvedValue(fakeProfile({ userId: USER_ID }));
      await service.getOwn(USER_ID);
      await service.update(USER_ID, { bio: 'x' });
      await service.getCompletion(USER_ID);
      for (const [opts] of model.findOne.mock.calls as [{ where: { userId: string } }][]) {
        expect(opts.where).toEqual({ userId: USER_ID });
      }
    });
  });

  describe('completion', () => {
    it('returns zero with all fields missing before onboarding', async () => {
      const { service } = setup();
      const r = await service.getCompletion(USER_ID);
      expect(r.profileCompletion).toBe(0);
      expect(r.missingFields).toContain('displayName');
    });
  });

  describe('remove', () => {
    it('hides, scrubs personal content and soft-deletes, keeping DOB', async () => {
      const { service, model, events, interestsService, tx } = setup();
      const profile = fakeProfile({ userId: USER_ID, bio: 'b', occupation: 'o', latitude: 1, longitude: 1 });
      model.findOne.mockResolvedValue(profile);

      await service.remove(USER_ID, ctx);

      expect(profile.isDiscoverable).toBe(false);
      expect(profile.profileVisibility).toBe(ProfileVisibility.Hidden);
      expect(profile.bio).toBeNull();
      expect(profile.latitude).toBeNull();
      expect(profile.dateOfBirth).toBe('1998-04-21');
      expect(profile.destroy).toHaveBeenCalled();
      expect(interestsService.removeAllForProfile).toHaveBeenCalledWith(profile.id, tx);
      expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: SecurityEventType.ProfileDeleted }));
    });

    it('scrubs identity fields and interest selections for account deletion', async () => {
      const { service, model, tx, interestsService } = setup();
      const profile = fakeProfile({ userId: USER_ID });
      model.findOne.mockResolvedValue(profile);
      await expect(service.deactivateForAccountDeletion(USER_ID, tx as unknown as Transaction)).resolves.toBe(true);
      expect(interestsService.removeAllForProfile).toHaveBeenCalledWith(profile.id, tx);
      expect(profile.profileCompletion).toBe(0);
      expect(profile.displayName).toBeNull();
      expect(profile.dateOfBirth).toBeNull();
      expect(profile.gender).toBeNull();
      expect(profile.isDiscoverable).toBe(false);
      expect(profile.save).toHaveBeenCalledWith({ transaction: tx });
    });

    it('deactivateForAccountDeletion is a no-op without a profile', async () => {
      const { service, tx, interestsService } = setup();
      await expect(service.deactivateForAccountDeletion(USER_ID, tx as unknown as Transaction)).resolves.toBe(false);
      expect(interestsService.removeAllForProfile).not.toHaveBeenCalled();
    });
  });
});
