import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type Transaction } from 'sequelize';

import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import { SettingsService } from '../settings/settings.service';
import { InterestResponse } from './dto/interest.response';
import { Interest } from './models/interest.model';
import { ProfileInterest } from './models/profile-interest.model';

/**
 * Profile interest selections (the catalogue is served by CatalogService). Knows nothing about users; callers
 * (ProfilesService) resolve the caller's own profile id first.
 */
@Injectable()
export class InterestsService {
  constructor(
    @InjectModel(Interest) private readonly interestModel: typeof Interest,
    @InjectModel(ProfileInterest) private readonly profileInterestModel: typeof ProfileInterest,
    private readonly settings: SettingsService,
  ) {}

  /** The profile.max_interests setting. */
  maxInterests(): Promise<number> {
    return this.settings.get('profile.max_interests');
  }

  /** Active interests selected by the profile, alphabetical. */
  async listForProfile(profileId: string, transaction?: Transaction): Promise<InterestResponse[]> {
    const rows = await this.profileInterestModel.findAll({
      where: { profileId },
      include: [{ model: this.interestModel, where: { isActive: true }, required: true }],
      transaction,
    });
    return rows
      .map((r) => r.interest)
      .filter((i): i is Interest => !!i)
      .map((i) => InterestResponse.fromModel(i))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  countActiveForProfile(profileId: string, transaction?: Transaction): Promise<number> {
    return this.profileInterestModel.count({
      where: { profileId },
      include: [{ model: this.interestModel, where: { isActive: true }, required: true }],
      transaction,
    });
  }

  /**
   * Atomically replaces the profile's selections. Must be called inside a transaction
   * that holds a lock on the profile row. Validates count and that every id is active.
   */
  async replaceForProfile(profileId: string, interestIds: string[], transaction: Transaction): Promise<number> {
    const ids = [...new Set(interestIds)];
    if (ids.length !== interestIds.length) {
      throw new AppException(ErrorCode.ValidationError, {
        errors: ['interestIds must not contain duplicates'],
      });
    }
    const max = await this.maxInterests();
    if (ids.length > max) {
      throw new AppException(ErrorCode.ValidationError, {
        errors: [`You can select at most ${max} interests`],
      });
    }

    if (ids.length > 0) {
      const found = await this.interestModel.findAll({
        attributes: ['id'],
        where: { id: { [Op.in]: ids }, isActive: true },
        transaction,
      });
      if (found.length !== ids.length) {
        const valid = new Set(found.map((f) => f.id));
        throw new AppException(ErrorCode.InvalidInterests, {
          invalidInterestIds: ids.filter((id) => !valid.has(id)),
        });
      }
    }

    await this.profileInterestModel.destroy({ where: { profileId }, transaction });
    if (ids.length > 0) {
      await this.profileInterestModel.bulkCreate(
        ids.map((interestId) => ({ profileId, interestId })),
        { transaction },
      );
    }
    return ids.length;
  }

  /** Removes every selection for the profile. Global interests are untouched. */
  async removeAllForProfile(profileId: string, transaction: Transaction): Promise<number> {
    return this.profileInterestModel.destroy({ where: { profileId }, transaction });
  }
}
