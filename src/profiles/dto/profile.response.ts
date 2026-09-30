import { ApiProperty } from '@nestjs/swagger';

import { Gender, type Profile, ProfileVisibility } from '../models/profile.model';
import { calculateAge } from '../utils/age.util';
import { ProfileCompletionResponse, ProfileField } from './profile-completion.response';

/** Coarse location only — exact coordinates are never returned. */
export class ProfileLocationResponse {
  @ApiProperty({ nullable: true, type: String }) city: string | null;
  @ApiProperty({ nullable: true, type: String }) state: string | null;
  @ApiProperty({ nullable: true, type: String }) country: string | null;
  @ApiProperty({ description: 'Whether coordinates are on file (values are never exposed)' })
  hasCoordinates: boolean;
  @ApiProperty({ nullable: true, type: Date }) updatedAt: Date | null;
}

/** The owner's view of their own profile. */
export class ProfileResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: String }) displayName: string | null;
  @ApiProperty({ type: String, format: 'date' }) dateOfBirth: string | null;
  @ApiProperty({ type: Number, nullable: true }) age: number | null;
  @ApiProperty({ enum: Gender, nullable: true }) gender: Gender | null;
  @ApiProperty({ nullable: true, type: String }) bio: string | null;
  @ApiProperty({ nullable: true, type: String }) occupation: string | null;
  @ApiProperty({ nullable: true, type: String }) education: string | null;
  @ApiProperty({ type: ProfileLocationResponse, nullable: true }) location: ProfileLocationResponse | null;
  @ApiProperty() isDiscoverable: boolean;
  @ApiProperty({ enum: ProfileVisibility }) profileVisibility: ProfileVisibility;
  @ApiProperty({ minimum: 0, maximum: 100 }) profileCompletion: number;
  @ApiProperty({ enum: ProfileField, isArray: true }) missingFields: ProfileField[];
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  static fromModel(p: Profile, completion: ProfileCompletionResponse): ProfileResponse {
    return ProfileResponse.fill(new ProfileResponse(), p, completion);
  }

  protected static fill<T extends ProfileResponse>(dto: T, p: Profile, completion: ProfileCompletionResponse): T {
    dto.id = p.id;
    dto.displayName = p.displayName;
    dto.dateOfBirth = p.dateOfBirth;
    dto.age = p.dateOfBirth ? calculateAge(p.dateOfBirth) : null;
    dto.gender = p.gender;
    dto.bio = p.bio;
    dto.occupation = p.occupation;
    dto.education = p.education;
    const hasCoordinates = p.latitude !== null && p.longitude !== null;
    dto.location =
      hasCoordinates || p.city || p.state || p.country
        ? {
            city: p.city,
            state: p.state,
            country: p.country,
            hasCoordinates,
            updatedAt: p.locationUpdatedAt,
          }
        : null;
    dto.isDiscoverable = p.isDiscoverable;
    dto.profileVisibility = p.profileVisibility;
    // Always freshly computed so weighting changes apply immediately.
    dto.profileCompletion = completion.profileCompletion;
    dto.missingFields = completion.missingFields;
    dto.createdAt = p.createdAt;
    dto.updatedAt = p.updatedAt;
    return dto;
  }
}
