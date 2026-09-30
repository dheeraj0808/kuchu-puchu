import { ApiProperty } from '@nestjs/swagger';

import { Gender } from '../../profiles/models/profile.model';
import { type DatingPreference, RelationshipIntent } from '../models/dating-preference.model';

export class PreferencesResponse {
  @ApiProperty({ description: 'False when the user has not saved preferences yet (defaults are returned)' })
  isConfigured: boolean;

  @ApiProperty({ example: 18 }) minAge: number;
  @ApiProperty({ example: 40 }) maxAge: number;

  @ApiProperty({ enum: Gender, isArray: true, description: 'Empty means not configured' })
  preferredGenders: Gender[];

  @ApiProperty({ example: 50 }) maxDistanceKm: number;

  @ApiProperty({ enum: RelationshipIntent, nullable: true })
  relationshipIntent: RelationshipIntent | null;

  @ApiProperty({ nullable: true, type: Date }) updatedAt: Date | null;

  static fromModel(p: DatingPreference): PreferencesResponse {
    return Object.assign(new PreferencesResponse(), {
      isConfigured: true,
      minAge: p.minAge,
      maxAge: p.maxAge,
      preferredGenders: [...p.preferredGenders],
      maxDistanceKm: p.maxDistanceKm,
      relationshipIntent: p.relationshipIntent,
      updatedAt: p.updatedAt,
    });
  }

  static defaults(maxDistanceKm: number): PreferencesResponse {
    return Object.assign(new PreferencesResponse(), {
      isConfigured: false,
      minAge: 18,
      maxAge: 40,
      preferredGenders: [],
      maxDistanceKm,
      relationshipIntent: null,
      updatedAt: null,
    });
  }
}
