import 'reflect-metadata';

import { HttpStatus } from '@nestjs/common';
import { type Transaction, UniqueConstraintError } from 'sequelize';

import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import { Gender } from '../profiles/models/profile.model';
import type { CreatePreferencesDto } from './dto/create-preferences.dto';
import { type DatingPreference, RelationshipIntent } from './models/dating-preference.model';
import { fakeSettings } from '../settings/testing/fake-settings';
import { PreferencesService } from './preferences.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';

interface ModelMock {
  findOne: jest.Mock;
  create: jest.Mock;
  destroy: jest.Mock;
}

type FakePref = DatingPreference & { set: jest.Mock; save: jest.Mock };

function fakePref(overrides: Partial<Record<keyof DatingPreference, unknown>> = {}): FakePref {
  const p: Record<string, unknown> = {
    id: '99999999-9999-4999-8999-999999999999',
    userId: USER_ID,
    minAge: 25,
    maxAge: 35,
    preferredGenders: [Gender.Woman],
    maxDistanceKm: 40,
    relationshipIntent: RelationshipIntent.LongTerm,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-02-01T00:00:00Z'),
    ...overrides,
  };
  p.set = jest.fn((changes: Record<string, unknown>) => Object.assign(p, changes));
  p.save = jest.fn().mockResolvedValue(p);
  return p as unknown as FakePref;
}

const dto = (overrides: Partial<CreatePreferencesDto> = {}): CreatePreferencesDto => ({
  minAge: 24,
  maxAge: 32,
  preferredGenders: [Gender.Other, Gender.Woman, Gender.Man],
  maxDistanceKm: 50,
  relationshipIntent: RelationshipIntent.Marriage,
  ...overrides,
});

async function expectAppError(p: Promise<unknown>, code: ErrorCode, status: HttpStatus): Promise<void> {
  const err: unknown = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppException);
  expect((err as AppException).code).toBe(code);
  expect((err as AppException).getStatus()).toBe(status);
}

describe('PreferencesService', () => {
  let model: ModelMock;

  const build = (limits: { minDistanceKm?: number; maxDistanceKm?: number } = {}): PreferencesService =>
    new PreferencesService(
      model as unknown as typeof DatingPreference,
      fakeSettings({
        'preferences.min_distance_km': limits.minDistanceKm ?? 1,
        'preferences.max_distance_km': limits.maxDistanceKm ?? 500,
      }),
    );

  beforeEach(() => {
    model = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((values: Record<string, unknown>) => Promise.resolve(fakePref(values))),
      destroy: jest.fn().mockResolvedValue(1),
    };
  });

  describe('getOwn', () => {
    it('returns defaults with isConfigured=false when nothing is saved', async () => {
      const res = await build().getOwn(USER_ID);
      expect(res).toEqual({
        isConfigured: false,
        minAge: 18,
        maxAge: 40,
        preferredGenders: [],
        maxDistanceKm: 50,
        relationshipIntent: null,
        updatedAt: null,
      });
      expect(model.findOne).toHaveBeenCalledWith({ where: { userId: USER_ID }, transaction: undefined });
    });

    it('clamps the default distance into the configured range', async () => {
      expect((await build({ minDistanceKm: 80, maxDistanceKm: 200 }).getOwn(USER_ID)).maxDistanceKm).toBe(80);
      expect((await build({ minDistanceKm: 1, maxDistanceKm: 20 }).getOwn(USER_ID)).maxDistanceKm).toBe(20);
    });

    it('maps an existing record without exposing id/userId', async () => {
      const pref = fakePref();
      model.findOne.mockResolvedValue(pref);
      const res = await build().getOwn(USER_ID);
      expect(res).toEqual({
        isConfigured: true,
        minAge: 25,
        maxAge: 35,
        preferredGenders: [Gender.Woman],
        maxDistanceKm: 40,
        relationshipIntent: RelationshipIntent.LongTerm,
        updatedAt: pref.updatedAt,
      });
      expect(res).not.toHaveProperty('userId');
      expect(res).not.toHaveProperty('id');
    });
  });

  describe('create', () => {
    it('stores the caller userId and canonical gender order', async () => {
      const res = await build().create(USER_ID, dto());
      expect(model.findOne).toHaveBeenCalledWith({ where: { userId: USER_ID }, transaction: undefined });
      expect(model.create).toHaveBeenCalledWith({
        minAge: 24,
        maxAge: 32,
        preferredGenders: [Gender.Woman, Gender.Man, Gender.Other],
        maxDistanceKm: 50,
        relationshipIntent: RelationshipIntent.Marriage,
        userId: USER_ID,
      });
      expect(res.isConfigured).toBe(true);
      expect(res.preferredGenders).toEqual([Gender.Woman, Gender.Man, Gender.Other]);
    });

    it('userId from the argument wins over anything smuggled into the dto', async () => {
      const smuggled = { ...dto(), userId: 'attacker' } as CreatePreferencesDto;
      await build().create(USER_ID, smuggled);
      const created = model.create.mock.calls[0][0] as { userId: string };
      expect(created.userId).toBe(USER_ID);
    });

    it('409 PREFERENCES_ALREADY_EXIST when a record exists; create() not called', async () => {
      model.findOne.mockResolvedValue(fakePref());
      await expectAppError(build().create(USER_ID, dto()), ErrorCode.PreferencesAlreadyExist, HttpStatus.CONFLICT);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('409 on a concurrent create (UniqueConstraintError)', async () => {
      model.create.mockRejectedValue(new UniqueConstraintError({}));
      await expectAppError(build().create(USER_ID, dto()), ErrorCode.PreferencesAlreadyExist, HttpStatus.CONFLICT);
    });

    it('rethrows other DB errors', async () => {
      const boom = new Error('db down');
      model.create.mockRejectedValue(boom);
      await expect(build().create(USER_ID, dto())).rejects.toBe(boom);
    });

    it('400 VALIDATION_ERROR when maxDistanceKm exceeds the configured max', async () => {
      await expectAppError(
        build().create(USER_ID, dto({ maxDistanceKm: 501 })),
        ErrorCode.ValidationError,
        HttpStatus.BAD_REQUEST,
      );
      expect(model.create).not.toHaveBeenCalled();
    });

    it('400 VALIDATION_ERROR when maxDistanceKm is below a configured min', async () => {
      await expectAppError(
        build({ minDistanceKm: 5 }).create(USER_ID, dto({ maxDistanceKm: 3 })),
        ErrorCode.ValidationError,
        HttpStatus.BAD_REQUEST,
      );
      expect(model.create).not.toHaveBeenCalled();
    });

    it('accepts the configured bounds inclusively', async () => {
      await expect(build().create(USER_ID, dto({ maxDistanceKm: 1 }))).resolves.toBeDefined();
      await expect(build().create(USER_ID, dto({ maxDistanceKm: 500 }))).resolves.toBeDefined();
    });

    it('400 when maxAge < minAge (service-level cross-check)', async () => {
      await expectAppError(
        build().create(USER_ID, dto({ minAge: 40, maxAge: 30 })),
        ErrorCode.ValidationError,
        HttpStatus.BAD_REQUEST,
      );
    });
  });

  describe('update', () => {
    it('merges a partial update with the existing record and saves', async () => {
      const pref = fakePref();
      model.findOne.mockResolvedValue(pref);
      const res = await build().update(USER_ID, { maxDistanceKm: 100, preferredGenders: [Gender.Man, Gender.Woman] });
      expect(model.findOne).toHaveBeenCalledWith({ where: { userId: USER_ID }, transaction: undefined });
      expect(pref.set).toHaveBeenCalledWith({
        minAge: 25,
        maxAge: 35,
        preferredGenders: [Gender.Woman, Gender.Man],
        maxDistanceKm: 100,
        relationshipIntent: RelationshipIntent.LongTerm,
      });
      expect(pref.save).toHaveBeenCalledTimes(1);
      expect(res).toEqual(expect.objectContaining({ isConfigured: true, maxDistanceKm: 100, minAge: 25 }));
    });

    it('400 when only minAge is sent and it exceeds the stored maxAge', async () => {
      const pref = fakePref({ minAge: 25, maxAge: 35 });
      model.findOne.mockResolvedValue(pref);
      await expectAppError(build().update(USER_ID, { minAge: 40 }), ErrorCode.ValidationError, HttpStatus.BAD_REQUEST);
      expect(pref.save).not.toHaveBeenCalled();
    });

    it('400 when the merged distance falls outside the configured range', async () => {
      const pref = fakePref();
      model.findOne.mockResolvedValue(pref);
      await expectAppError(
        build().update(USER_ID, { maxDistanceKm: 501 }),
        ErrorCode.ValidationError,
        HttpStatus.BAD_REQUEST,
      );
      expect(pref.save).not.toHaveBeenCalled();
    });

    it('404 PREFERENCES_NOT_FOUND when nothing is saved', async () => {
      await expectAppError(
        build().update(USER_ID, { minAge: 20 }),
        ErrorCode.PreferencesNotFound,
        HttpStatus.NOT_FOUND,
      );
    });
  });

  describe('deleteForUser', () => {
    it('destroys only the caller record within the transaction', async () => {
      const tx = {} as Transaction;
      await expect(build().deleteForUser(USER_ID, tx)).resolves.toBe(1);
      expect(model.destroy).toHaveBeenCalledWith({ where: { userId: USER_ID }, transaction: tx });
    });
  });
});
