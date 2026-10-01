import 'reflect-metadata';

import { Op, type Transaction } from 'sequelize';

import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import { fakeSettings } from '../settings/testing/fake-settings';
import { InterestsService } from './interests.service';
import type { Interest } from './models/interest.model';
import type { ProfileInterest } from './models/profile-interest.model';

const PROFILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tx = { id: 'tx' } as unknown as Transaction;

const row = (n: number, name: string): Record<string, unknown> => ({
  id: id(n),
  name,
  slug: name.toLowerCase(),
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
});

function setup() {
  const interestModel = {
    findAll: jest.fn().mockResolvedValue([]),
    destroy: jest.fn(),
    update: jest.fn(),
  };
  const profileInterestModel = {
    findAll: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    destroy: jest.fn().mockResolvedValue(0),
    bulkCreate: jest.fn().mockResolvedValue([]),
  };
  const service = new InterestsService(
    interestModel as unknown as typeof Interest,
    profileInterestModel as unknown as typeof ProfileInterest,
    fakeSettings({ 'profile.max_interests': 5 }),
  );
  return { service, interestModel, profileInterestModel };
}

/** interestModel.findAll implementation that returns the requested ids that are in `active`. */
const activeLookup =
  (active: string[]) =>
  (opts: { where: { id: { [Op.in]: string[] } } }): Promise<{ id: string }[]> =>
    Promise.resolve(opts.where.id[Op.in].filter((i) => active.includes(i)).map((i) => ({ id: i })));

const catchApp = async (p: Promise<unknown>): Promise<AppException> => {
  const e: unknown = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AppException);
  return e as AppException;
};

describe('InterestsService', () => {
  it('reads the max from the profile.max_interests setting', async () => {
    await expect(setup().service.maxInterests()).resolves.toBe(5);
  });

  describe('listForProfile / countActiveForProfile', () => {
    it('joins only active interests for that profile and sorts by name', async () => {
      const { service, interestModel, profileInterestModel } = setup();
      profileInterestModel.findAll.mockResolvedValue([
        { interest: row(2, 'Music') },
        { interest: row(1, 'Art') },
        { interest: undefined },
      ]);

      const res = await service.listForProfile(PROFILE_ID, tx);

      expect(profileInterestModel.findAll).toHaveBeenCalledWith({
        where: { profileId: PROFILE_ID },
        include: [{ model: interestModel, where: { isActive: true }, required: true }],
        transaction: tx,
      });
      expect(res).toEqual([
        { id: id(1), name: 'Art', slug: 'art' },
        { id: id(2), name: 'Music', slug: 'music' },
      ]);
    });

    it('counts only active interests', async () => {
      const { service, interestModel, profileInterestModel } = setup();
      profileInterestModel.count.mockResolvedValue(2);
      await expect(service.countActiveForProfile(PROFILE_ID)).resolves.toBe(2);
      expect(profileInterestModel.count).toHaveBeenCalledWith({
        where: { profileId: PROFILE_ID },
        include: [{ model: interestModel, where: { isActive: true }, required: true }],
        transaction: undefined,
      });
    });
  });

  describe('replaceForProfile', () => {
    it('replaces rows for that profile only, inside the transaction', async () => {
      const { service, interestModel, profileInterestModel } = setup();
      interestModel.findAll.mockImplementation(activeLookup([id(1), id(2)]));

      await expect(service.replaceForProfile(PROFILE_ID, [id(1), id(2)], tx)).resolves.toBe(2);

      expect(interestModel.findAll).toHaveBeenCalledWith({
        attributes: ['id'],
        where: { id: { [Op.in]: [id(1), id(2)] }, isActive: true },
        transaction: tx,
      });
      expect(profileInterestModel.destroy).toHaveBeenCalledWith({ where: { profileId: PROFILE_ID }, transaction: tx });
      expect(profileInterestModel.bulkCreate).toHaveBeenCalledWith(
        [
          { profileId: PROFILE_ID, interestId: id(1) },
          { profileId: PROFILE_ID, interestId: id(2) },
        ],
        { transaction: tx },
      );
      expect(interestModel.destroy).not.toHaveBeenCalled();
    });

    it('rejects duplicate ids with 400', async () => {
      const { service, profileInterestModel } = setup();
      const e = await catchApp(service.replaceForProfile(PROFILE_ID, [id(1), id(1)], tx));
      expect(e.code).toBe(ErrorCode.ValidationError);
      expect(e.getStatus()).toBe(400);
      expect(profileInterestModel.destroy).not.toHaveBeenCalled();
      expect(profileInterestModel.bulkCreate).not.toHaveBeenCalled();
    });

    it('rejects nonexistent or inactive ids with INVALID_INTERESTS', async () => {
      const { service, interestModel, profileInterestModel } = setup();
      interestModel.findAll.mockImplementation(activeLookup([id(1)]));

      const e = await catchApp(service.replaceForProfile(PROFILE_ID, [id(1), id(2), id(3)], tx));

      expect(e.code).toBe(ErrorCode.InvalidInterests);
      expect(e.getStatus()).toBe(400);
      expect(e.details).toEqual({ invalidInterestIds: [id(2), id(3)] });
      expect(profileInterestModel.destroy).not.toHaveBeenCalled();
      expect(profileInterestModel.bulkCreate).not.toHaveBeenCalled();
    });

    it('rejects more than the configured max (5) and changes nothing', async () => {
      const { service, interestModel, profileInterestModel } = setup();
      const ids = [1, 2, 3, 4, 5, 6].map(id);
      interestModel.findAll.mockImplementation(activeLookup(ids));

      const e = await catchApp(service.replaceForProfile(PROFILE_ID, ids, tx));

      expect(e.code).toBe(ErrorCode.ValidationError);
      expect(e.getStatus()).toBe(400);
      expect(interestModel.findAll).not.toHaveBeenCalled();
      expect(profileInterestModel.destroy).not.toHaveBeenCalled();
      expect(profileInterestModel.bulkCreate).not.toHaveBeenCalled();
    });

    it('accepts exactly the max', async () => {
      const { service, interestModel } = setup();
      const ids = [1, 2, 3, 4, 5].map(id);
      interestModel.findAll.mockImplementation(activeLookup(ids));
      await expect(service.replaceForProfile(PROFILE_ID, ids, tx)).resolves.toBe(5);
    });

    it('clears all selections with an empty array', async () => {
      const { service, interestModel, profileInterestModel } = setup();
      await expect(service.replaceForProfile(PROFILE_ID, [], tx)).resolves.toBe(0);
      expect(interestModel.findAll).not.toHaveBeenCalled();
      expect(profileInterestModel.destroy).toHaveBeenCalledWith({ where: { profileId: PROFILE_ID }, transaction: tx });
      expect(profileInterestModel.bulkCreate).not.toHaveBeenCalled();
    });
  });

  describe('removeAllForProfile', () => {
    it('destroys only that profile selections and never the catalogue', async () => {
      const { service, interestModel, profileInterestModel } = setup();
      profileInterestModel.destroy.mockResolvedValue(3);
      await expect(service.removeAllForProfile(PROFILE_ID, tx)).resolves.toBe(3);
      expect(profileInterestModel.destroy).toHaveBeenCalledWith({ where: { profileId: PROFILE_ID }, transaction: tx });
      expect(interestModel.destroy).not.toHaveBeenCalled();
      expect(interestModel.update).not.toHaveBeenCalled();
    });
  });
});
