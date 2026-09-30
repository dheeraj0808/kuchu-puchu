import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { UniqueConstraintError, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import type { RequestContext } from '../common/utils/request-context';
import { SecurityEventType } from '../security/models/security-event.model';
import { SecurityEventsService } from '../security/security-events.service';
import type { CreateProfileDto } from './dto/create-profile.dto';
import type { LocationDto } from './dto/location.dto';
import type { ProfileCompletionResponse } from './dto/profile-completion.response';
import { ProfileResponse } from './dto/profile.response';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import { Profile, ProfileVisibility } from './models/profile.model';
import { COORDINATE_DECIMALS } from './profile.constants';
import { ProfileCompletionService } from './profile-completion.service';
import { InterestsService } from '../interests/interests.service';
import type { ProfileInterestsResponse } from '../interests/dto/profile-interests.response';
import { PreferencesService } from '../preferences/preferences.service';
import { ProfileDetailResponse } from './dto/profile-detail.response';

type LocationAttrs = Pick<
  Profile,
  'latitude' | 'longitude' | 'city' | 'state' | 'country' | 'locationUpdatedAt'
>;

const roundCoordinate = (v: number): number => {
  const f = 10 ** COORDINATE_DECIMALS;
  return Math.round(v * f) / f;
};

function locationAttrs(location: LocationDto | null, now: Date): LocationAttrs {
  if (!location) {
    return { latitude: null, longitude: null, city: null, state: null, country: null, locationUpdatedAt: now };
  }
  return {
    latitude: roundCoordinate(location.latitude),
    longitude: roundCoordinate(location.longitude),
    city: location.city ?? null,
    state: location.state ?? null,
    country: location.country ?? null,
    locationUpdatedAt: now,
  };
}

const notFound = (): AppException =>
  new AppException(ErrorCode.ProfileNotFound);

/**
 * All operations are keyed by the authenticated user's id — there is no way to
 * address another user's profile through this service's public API.
 */
@Injectable()
export class ProfilesService {
  constructor(
    @InjectModel(Profile) private readonly profileModel: typeof Profile,
    private readonly completion: ProfileCompletionService,
    private readonly securityEvents: SecurityEventsService,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly interests: InterestsService,
    private readonly preferences: PreferencesService,
  ) {}

  findByUserId(userId: string, transaction?: Transaction): Promise<Profile | null> {
    return this.profileModel.findOne({ where: { userId }, transaction });
  }

  /** Owner's full view: profile + interests + preferences. */
  async getOwn(userId: string): Promise<ProfileDetailResponse> {
    const profile = await this.findByUserId(userId);
    if (!profile) throw notFound();
    const [interests, preferences] = await Promise.all([
      this.interests.listForProfile(profile.id),
      this.preferences.getOwn(userId),
    ]);
    const completion = this.completion.calculate({ ...profile.get(), interestCount: interests.length });
    return ProfileDetailResponse.build(profile, completion, interests, preferences);
  }

  /** Compact view used by /auth/me (no interests/preferences payload). */
  async getOwnOrNull(userId: string): Promise<ProfileResponse | null> {
    const profile = await this.findByUserId(userId);
    return profile ? this.toResponse(profile) : null;
  }

  async getCompletion(userId: string): Promise<ProfileCompletionResponse> {
    const profile = await this.findByUserId(userId);
    if (!profile) return this.completion.calculate(null);
    return this.completionFor(profile);
  }

  async getOwnInterests(userId: string): Promise<ProfileInterestsResponse> {
    const profile = await this.findByUserId(userId);
    const interests = profile ? await this.interests.listForProfile(profile.id) : [];
    return { interests, maxInterests: this.interests.maxInterests };
  }

  /** Atomically replaces the caller's interests and refreshes stored completion. */
  async replaceOwnInterests(userId: string, interestIds: string[]): Promise<ProfileInterestsResponse> {
    const interests = await this.sequelize.transaction(async (transaction) => {
      const profile = await this.profileModel.findOne({
        where: { userId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!profile) throw notFound();
      const count = await this.interests.replaceForProfile(profile.id, interestIds, transaction);
      profile.set(
        'profileCompletion',
        this.completion.calculate({ ...profile.get(), interestCount: count }).profileCompletion,
      );
      await profile.save({ transaction });
      return this.interests.listForProfile(profile.id, transaction);
    });
    return { interests, maxInterests: this.interests.maxInterests };
  }

  async create(userId: string, dto: CreateProfileDto, ctx: RequestContext): Promise<ProfileResponse> {
    const now = new Date();
    const attrs = {
      displayName: dto.displayName,
      dateOfBirth: dto.dateOfBirth,
      gender: dto.gender,
      bio: dto.bio ?? null,
      occupation: dto.occupation ?? null,
      education: dto.education ?? null,
      ...(dto.location ? locationAttrs(dto.location, now) : {}),
      isDiscoverable: dto.isDiscoverable ?? true,
      profileVisibility: dto.profileVisibility ?? ProfileVisibility.Public,
    };

    const profile = await this.sequelize.transaction(async (transaction) => {
      const existing = await this.profileModel.findOne({
        where: { userId },
        paranoid: false,
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (existing && !existing.deletedAt) {
        throw new AppException(ErrorCode.ProfileAlreadyExists);
      }

      if (existing) {
        // Re-creating after a profile deletion: the retained DOB cannot be changed.
        if (existing.dateOfBirth && existing.dateOfBirth !== dto.dateOfBirth) {
          throw new AppException(ErrorCode.ProfileDobLocked);
        }
        await existing.restore({ transaction });
        existing.set(attrs);
        // Interests were removed on deletion, so the count is zero.
        existing.set('profileCompletion', this.completion.calculate({ ...existing.get(), interestCount: 0 }).profileCompletion);
        return existing.save({ transaction });
      }

      const draft = this.profileModel.build({ userId, ...attrs });
      draft.set('profileCompletion', this.completion.calculate({ ...draft.get(), interestCount: 0 }).profileCompletion);
      try {
        return await draft.save({ transaction });
      } catch (err) {
        if (err instanceof UniqueConstraintError) {
          throw new AppException(ErrorCode.ProfileAlreadyExists);
        }
        throw err;
      }
    });

    await this.securityEvents.record({ eventType: SecurityEventType.ProfileCreated, userId, context: ctx });
    return this.toResponse(profile);
  }

  async update(userId: string, dto: UpdateProfileDto): Promise<ProfileResponse> {
    const profile = await this.findByUserId(userId);
    if (!profile) throw notFound();

    const changes: Partial<Profile> = {};
    if (dto.displayName !== undefined) changes.displayName = dto.displayName;
    if (dto.gender !== undefined) changes.gender = dto.gender;
    if (dto.bio !== undefined) changes.bio = dto.bio;
    if (dto.occupation !== undefined) changes.occupation = dto.occupation;
    if (dto.education !== undefined) changes.education = dto.education;
    if (dto.isDiscoverable !== undefined) changes.isDiscoverable = dto.isDiscoverable;
    if (dto.profileVisibility !== undefined) changes.profileVisibility = dto.profileVisibility;
    if (dto.location !== undefined) Object.assign(changes, locationAttrs(dto.location, new Date()));

    profile.set(changes);
    const completion = await this.completionFor(profile);
    profile.set('profileCompletion', completion.profileCompletion);
    await profile.save();
    return ProfileResponse.fromModel(profile, completion);
  }

  /** Deactivates the profile: hidden, not discoverable, personal content scrubbed, soft-deleted. DOB is retained. */
  async remove(userId: string, ctx: RequestContext): Promise<void> {
    await this.sequelize.transaction(async (transaction) => {
      const profile = await this.findByUserId(userId, transaction);
      if (!profile) throw notFound();
      await this.deactivate(profile, { scrubIdentity: false }, transaction);
    });
    await this.securityEvents.record({ eventType: SecurityEventType.ProfileDeleted, userId, context: ctx });
  }

  /** Used by account deletion: scrubs everything including DOB/name/gender. No-op when absent. */
  async deactivateForAccountDeletion(userId: string, transaction: Transaction): Promise<boolean> {
    const profile = await this.profileModel.findOne({ where: { userId }, paranoid: false, transaction });
    if (!profile) return false;
    await this.deactivate(profile, { scrubIdentity: true }, transaction);
    return true;
  }

  async toResponse(profile: Profile): Promise<ProfileResponse> {
    return ProfileResponse.fromModel(profile, await this.completionFor(profile));
  }

  private async completionFor(profile: Profile, transaction?: Transaction): Promise<ProfileCompletionResponse> {
    const interestCount = await this.interests.countActiveForProfile(profile.id, transaction);
    return this.completion.calculate({ ...profile.get(), interestCount });
  }

  private async deactivate(profile: Profile, opts: { scrubIdentity: boolean }, transaction: Transaction): Promise<void> {
    // Selections are personal data; the global interest catalogue is untouched.
    await this.interests.removeAllForProfile(profile.id, transaction);
    profile.set({
      isDiscoverable: false,
      profileVisibility: ProfileVisibility.Hidden,
      bio: null,
      occupation: null,
      education: null,
      ...locationAttrs(null, new Date()),
      ...(opts.scrubIdentity ? { displayName: null, dateOfBirth: null, gender: null } : {}),
    });
    profile.set('profileCompletion', this.completion.calculate({ ...profile.get(), interestCount: 0 }).profileCompletion);
    await profile.save({ transaction });
    if (!profile.deletedAt) await profile.destroy({ transaction });
  }
}
