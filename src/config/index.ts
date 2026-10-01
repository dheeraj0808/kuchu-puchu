import appConfig from './app.config';
import databaseConfig from './database.config';
import jwtConfig from './jwt.config';
import otpConfig from './otp.config';
import outboxConfig from './outbox.config';
import securityConfig from './security.config';
import { verificationConfig } from './verification.config';
import { alertsConfig, awsConfig, fcmConfig, redisConfig } from './integrations.config';
import { emailConfig, smsConfig } from './messaging.config';

export { getValidatedEnv, validateEnv } from './env.validation';
export { appConfig, databaseConfig, jwtConfig, otpConfig, outboxConfig };

export const configLoaders = [
  appConfig,
  databaseConfig,
  jwtConfig,
  otpConfig,
  outboxConfig,
  securityConfig,
  redisConfig,
  awsConfig,
  fcmConfig,
  alertsConfig,
  smsConfig,
  emailConfig,
  verificationConfig,
];
