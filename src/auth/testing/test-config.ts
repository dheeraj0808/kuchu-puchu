import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';
import { AppRole } from '../../config/env.validation';
import type { JwtConfig } from '../../config/jwt.config';
import type { OtpConfig } from '../../config/otp.config';
import type { ProfileConfig } from '../../config/profile.config';

export const TEST_OTP_CONFIG: OtpConfig = {
  hashSecret: 'test-otp-hash-secret-0123456789abcdef0123',
  length: 6,
  ttlSeconds: 300,
  maxAttempts: 5,
  resendCooldownSeconds: 60,
  maxRequestsPerHour: 5,
  devEcho: false,
};

export const TEST_JWT_CONFIG: JwtConfig = {
  accessSecret: 'test-access-secret-0123456789abcdef0123456789',
  refreshSecret: 'test-refresh-secret-0123456789abcdef012345678',
  accessExpiresIn: '15m',
  refreshExpiresIn: '7d',
  issuer: 'kuchu-puchu',
  audience: 'kuchu-puchu-app',
};

export const TEST_APP_CONFIG: AppConfig = {
  nodeEnv: 'test',
  role: AppRole.Api,
  sentryDsn: undefined,
  isProduction: false,
  port: 3000,
  corsOrigins: [],
  trustProxy: undefined,
  logLevel: 'silent',
  swaggerEnabled: false,
};

export const TEST_PROFILE_CONFIG: ProfileConfig = {
  maxInterests: 5,
  minDistanceKm: 1,
  maxDistanceKm: 500,
};

export function createTestConfig(
  overrides: {
    otp?: Partial<OtpConfig>;
    jwt?: Partial<JwtConfig>;
    app?: Partial<AppConfig>;
    profile?: Partial<ProfileConfig>;
  } = {},
): ConfigService {
  return new ConfigService({
    otp: { ...TEST_OTP_CONFIG, ...overrides.otp },
    jwt: { ...TEST_JWT_CONFIG, ...overrides.jwt },
    app: { ...TEST_APP_CONFIG, ...overrides.app },
    profile: { ...TEST_PROFILE_CONFIG, ...overrides.profile },
  });
}
