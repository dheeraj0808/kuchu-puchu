import appConfig from './app.config';
import databaseConfig from './database.config';
import jwtConfig from './jwt.config';
import otpConfig from './otp.config';
import outboxConfig from './outbox.config';
import profileConfig from './profile.config';
import securityConfig from './security.config';
import { alertsConfig, awsConfig, fcmConfig, redisConfig } from './integrations.config';

export { getValidatedEnv, validateEnv } from './env.validation';
export { appConfig, databaseConfig, jwtConfig, otpConfig, outboxConfig, profileConfig };

export const configLoaders = [
  appConfig,
  databaseConfig,
  jwtConfig,
  otpConfig,
  outboxConfig,
  profileConfig,
  securityConfig,
  redisConfig,
  awsConfig,
  fcmConfig,
  alertsConfig,
];
