import { registerAs } from '@nestjs/config';

import { getValidatedEnv } from './env.validation';

export interface JwtConfig {
  accessSecret: string;
  refreshSecret: string;
  accessExpiresIn: string;
  /** Guide M06: expires_at moves to now + this on every refresh. */
  sessionSlidingDays: number;
  /** Guide M06: absolute_expires_at = created_at + this; never extended. */
  sessionMaxDays: number;
  issuer: string;
  audience: string;
}

export default registerAs('jwt', (): JwtConfig => {
  const env = getValidatedEnv();
  return {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessExpiresIn: env.JWT_ACCESS_TTL,
    sessionSlidingDays: env.SESSION_SLIDING_DAYS,
    sessionMaxDays: env.SESSION_MAX_DAYS,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  };
});
