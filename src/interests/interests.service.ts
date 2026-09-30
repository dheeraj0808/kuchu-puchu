import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type Transaction } from 'sequelize';

import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import type { ProfileConfig } from '../config/profile.config';
import { InterestResponse } from './dto/interest.response';
import { Interest } from './models/interest.model';
import { ProfileInterest } from './models/profile-interest.model';

/**
 * Interest catalogue + profile selections. Knows nothing about users; callers
 * (ProfilesService) resolve the caller's own profile id first.
 */
@Injectable()
export class InterestsService {
  constructor(
    @InjectModel(Interest) private readonly interestModel: typeof Interest,
    @InjectModel(ProfileInterest) private readonly profileInterestModel: typeof ProfileInterest,
    private readonly config: ConfigService,
  ) {}

  get maxInterests(): number {
    return this.config.getOrThrow<ProfileConfig>('profile').maxInterests;
  }

  async listActive(): Promise<InterestResponse[]> {
    const rows = await this.interestModel.findAll({ where: { isActive: true }, order: [['name', 'ASC']] });
    return rows.map((r) => InterestResponse.fromModel(r));
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
      throw new AppException(ErrorCode.ValidationError, 'Validation failed', HttpStatus.BAD_REQUEST, {
        errors: ['interestIds must not contain duplicates'],
      });
    }
    const max = this.maxInterests;
    if (ids.length > max) {
      throw new AppException(ErrorCode.ValidationError, 'Validation failed', HttpStatus.BAD_REQUEST, {
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
        throw new AppException(
          ErrorCode.InvalidInterests,
          'One or more interests are invalid or unavailable',
          HttpStatus.BAD_REQUEST,
          { invalidInterestIds: ids.filter((id) => !valid.has(id)) },
        );
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
