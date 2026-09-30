import { registerAs } from '@nestjs/config';

import { getValidatedEnv } from './env.validation';

export interface ProfileConfig {
  maxInterests: number;
  minDistanceKm: number;
  maxDistanceKm: number;
}

export default registerAs('profile', (): ProfileConfig => {
  const env = getValidatedEnv();
  return {
    maxInterests: env.PROFILE_MAX_INTERESTS,
    minDistanceKm: env.PREFERENCES_MIN_DISTANCE_KM,
    maxDistanceKm: env.PREFERENCES_MAX_DISTANCE_KM,
  };
});
