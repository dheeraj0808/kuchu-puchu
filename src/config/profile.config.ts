import { registerAs } from '@nestjs/config';

import { envInt } from './env.helpers';

export interface ProfileConfig {
  maxInterests: number;
  minDistanceKm: number;
  maxDistanceKm: number;
}

export default registerAs(
  'profile',
  (): ProfileConfig => ({
    maxInterests: envInt('PROFILE_MAX_INTERESTS', 10),
    minDistanceKm: envInt('PREFERENCES_MIN_DISTANCE_KM', 1),
    maxDistanceKm: envInt('PREFERENCES_MAX_DISTANCE_KM', 500),
  }),
);
