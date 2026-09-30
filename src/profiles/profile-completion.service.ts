import { Injectable } from '@nestjs/common';

import { ProfileCompletionResponse, ProfileField } from './dto/profile-completion.response';
import type { Profile } from './models/profile.model';

export type CompletionInput = Pick<
  Profile,
  'displayName' | 'dateOfBirth' | 'gender' | 'bio' | 'occupation' | 'education' | 'latitude' | 'longitude'
> & {
  /** Number of active interests selected. */
  interestCount: number;
};

/** Selecting at least this many interests counts the interests section as complete. */
export const MIN_INTERESTS_FOR_COMPLETION = 3;

type Rule = { field: ProfileField; weight: number; isPresent: (p: CompletionInput) => boolean };

/**
 * Single source of truth for profile completion. Weights must sum to 100.
 * TODO(phase 4): add photos and rebalance.
 */
export const COMPLETION_RULES: ReadonlyArray<Rule> = [
  { field: ProfileField.DisplayName, weight: 15, isPresent: (p) => !!p.displayName },
  { field: ProfileField.DateOfBirth, weight: 15, isPresent: (p) => !!p.dateOfBirth },
  { field: ProfileField.Gender, weight: 10, isPresent: (p) => !!p.gender },
  { field: ProfileField.Bio, weight: 15, isPresent: (p) => !!p.bio },
  { field: ProfileField.Location, weight: 15, isPresent: (p) => p.latitude !== null && p.longitude !== null },
  { field: ProfileField.Occupation, weight: 5, isPresent: (p) => !!p.occupation },
  { field: ProfileField.Education, weight: 5, isPresent: (p) => !!p.education },
  {
    field: ProfileField.Interests,
    weight: 20,
    isPresent: (p) => p.interestCount >= MIN_INTERESTS_FOR_COMPLETION,
  },
];

@Injectable()
export class ProfileCompletionService {
  calculate(profile: CompletionInput | null): ProfileCompletionResponse {
    let score = 0;
    const missingFields: ProfileField[] = [];
    for (const rule of COMPLETION_RULES) {
      if (profile && rule.isPresent(profile)) score += rule.weight;
      else missingFields.push(rule.field);
    }
    return { profileCompletion: Math.min(100, score), missingFields };
  }
}
