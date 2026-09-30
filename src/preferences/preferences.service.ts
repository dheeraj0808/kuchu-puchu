import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { type Transaction, UniqueConstraintError } from 'sequelize';

import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import type { ProfileConfig } from '../config/profile.config';
import { Gender } from '../profiles/models/profile.model';
import type { CreatePreferencesDto } from './dto/create-preferences.dto';
import { PreferencesResponse } from './dto/preferences.response';
import type { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { DatingPreference } from './models/dating-preference.model';

const DEFAULT_DISTANCE_KM = 50;
const GENDER_ORDER = Object.values(Gender);

const validationError = (message: string): AppException =>
  new AppException(ErrorCode.ValidationError, { errors: [message] });

/** One preference record per user; every method is keyed by the authenticated user id. */
@Injectable()
export class PreferencesService {
  constructor(
    @InjectModel(DatingPreference) private readonly preferenceModel: typeof DatingPreference,
    private readonly config: ConfigService,
  ) {}

  private get cfg(): ProfileConfig {
    return this.config.getOrThrow<ProfileConfig>('profile');
  }

  findByUserId(userId: string, transaction?: Transaction): Promise<DatingPreference | null> {
    return this.preferenceModel.findOne({ where: { userId }, transaction });
  }

  async getOwn(userId: string): Promise<PreferencesResponse> {
    const pref = await this.findByUserId(userId);
    if (pref) return PreferencesResponse.fromModel(pref);
    const { minDistanceKm, maxDistanceKm } = this.cfg;
    return PreferencesResponse.defaults(Math.min(Math.max(DEFAULT_DISTANCE_KM, minDistanceKm), maxDistanceKm));
  }

  async create(userId: string, dto: CreatePreferencesDto): Promise<PreferencesResponse> {
    if (await this.findByUserId(userId)) throw this.alreadyExists();
    const values = this.validated(dto);
    try {
      const pref = await this.preferenceModel.create({ ...values, userId });
      return PreferencesResponse.fromModel(pref);
    } catch (err) {
      // Concurrent create for the same user hits the unique(user_id) constraint.
      if (err instanceof UniqueConstraintError) throw this.alreadyExists();
      throw err;
    }
  }

  async update(userId: string, dto: UpdatePreferencesDto): Promise<PreferencesResponse> {
    const pref = await this.findByUserId(userId);
    if (!pref) {
      throw new AppException(ErrorCode.PreferencesNotFound);
    }
    const merged = this.validated({
      minAge: dto.minAge ?? pref.minAge,
      maxAge: dto.maxAge ?? pref.maxAge,
      preferredGenders: dto.preferredGenders ?? pref.preferredGenders,
      maxDistanceKm: dto.maxDistanceKm ?? pref.maxDistanceKm,
      relationshipIntent: dto.relationshipIntent ?? pref.relationshipIntent,
    });
    pref.set(merged);
    await pref.save();
    return PreferencesResponse.fromModel(pref);
  }

  /** Account deletion: hard-deletes the record (not needed for audit). */
  async deleteForUser(userId: string, transaction: Transaction): Promise<number> {
    return this.preferenceModel.destroy({ where: { userId }, transaction });
  }

  /** Cross-field and config-dependent checks on the full (merged) record. */
  private validated(v: CreatePreferencesDto): CreatePreferencesDto {
    if (v.maxAge < v.minAge) throw validationError('maxAge must not be below minAge');
    const { minDistanceKm, maxDistanceKm } = this.cfg;
    if (v.maxDistanceKm < minDistanceKm || v.maxDistanceKm > maxDistanceKm) {
      throw validationError(`maxDistanceKm must be between ${minDistanceKm} and ${maxDistanceKm}`);
    }
    // Explicit whitelist: never pass through keys other than these five.
    return {
      minAge: v.minAge,
      maxAge: v.maxAge,
      // Canonical order so equal selections compare equal.
      preferredGenders: GENDER_ORDER.filter((g) => v.preferredGenders.includes(g)),
      maxDistanceKm: v.maxDistanceKm,
      relationshipIntent: v.relationshipIntent,
    };
  }

  private alreadyExists(): AppException {
    return new AppException(ErrorCode.PreferencesAlreadyExist);
  }
}
