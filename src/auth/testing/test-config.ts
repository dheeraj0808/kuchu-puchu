import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';
import { AppRole } from '../../config/env.validation';
import type { JwtConfig } from '../../config/jwt.config';
import type { OtpConfig } from '../../config/otp.config';

export const TEST_OTP_CONFIG: OtpConfig = {
  hashSecret: 'test-otp-hash-secret-0123456789abcdef0123',
  length: 6,
  ttlSeconds: 300,
  maxAttempts: 5,
  resendCooldownSeconds: 60,
  maxRequestsPerHour: 5,
  maxRequestsPerIpPerHour: 20,
  maxRequestsPerDevicePerHour: 10,
  reauthMaxRequestsPerHour: 5,
  smsAllowedCountries: ['+91'],
  devEcho: false,
};

export const TEST_JWT_CONFIG: JwtConfig = {
  accessSecret: 'test-access-secret-0123456789abcdef0123456789',
  refreshSecret: 'test-refresh-secret-0123456789abcdef012345678',
  accessExpiresIn: '15m',
  sessionSlidingDays: 30,
  sessionMaxDays: 90,
  sessionMaxPerUser: 10,
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

export function createTestConfig(
  overrides: {
    otp?: Partial<OtpConfig>;
    jwt?: Partial<JwtConfig>;
    app?: Partial<AppConfig>;
  } = {},
): ConfigService {
  return new ConfigService({
    otp: { ...TEST_OTP_CONFIG, ...overrides.otp },
    jwt: { ...TEST_JWT_CONFIG, ...overrides.jwt },
    app: { ...TEST_APP_CONFIG, ...overrides.app },
  });
}
