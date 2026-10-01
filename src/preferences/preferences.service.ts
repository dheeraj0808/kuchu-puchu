import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { type Transaction, UniqueConstraintError } from 'sequelize';

import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import { Gender } from '../profiles/models/profile.model';
import type { CreatePreferencesDto } from './dto/create-preferences.dto';
import { PreferencesResponse } from './dto/preferences.response';
import type { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { SettingsService } from '../settings/settings.service';
import { DatingPreference } from './models/dating-preference.model';

const GENDER_ORDER = Object.values(Gender);

const validationError = (message: string): AppException =>
  new AppException(ErrorCode.ValidationError, { errors: [message] });

/** One preference record per user; every method is keyed by the authenticated user id. */
@Injectable()
export class PreferencesService {
  constructor(
    @InjectModel(DatingPreference) private readonly preferenceModel: typeof DatingPreference,
    private readonly settings: SettingsService,
  ) {}

  /** preferences.min_distance_km / max_distance_km / default_distance_km (M08 settings). */
  private async distances(): Promise<{ minDistanceKm: number; maxDistanceKm: number; defaultDistanceKm: number }> {
    const s = await this.settings.all();
    return {
      minDistanceKm: s['preferences.min_distance_km'],
      maxDistanceKm: s['preferences.max_distance_km'],
      defaultDistanceKm: s['preferences.default_distance_km'],
    };
  }

  findByUserId(userId: string, transaction?: Transaction): Promise<DatingPreference | null> {
    return this.preferenceModel.findOne({ where: { userId }, transaction });
  }

  async getOwn(userId: string): Promise<PreferencesResponse> {
    const pref = await this.findByUserId(userId);
    if (pref) return PreferencesResponse.fromModel(pref);
    const { minDistanceKm, maxDistanceKm, defaultDistanceKm } = await this.distances();
    return PreferencesResponse.defaults(Math.min(Math.max(defaultDistanceKm, minDistanceKm), maxDistanceKm));
  }

  async create(userId: string, dto: CreatePreferencesDto): Promise<PreferencesResponse> {
    if (await this.findByUserId(userId)) throw this.alreadyExists();
    const values = await this.validated(dto);
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
    const merged = await this.validated({
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
  private async validated(v: CreatePreferencesDto): Promise<CreatePreferencesDto> {
    if (v.maxAge < v.minAge) throw validationError('maxAge must not be below minAge');
    const { minDistanceKm, maxDistanceKm } = await this.distances();
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
