import appConfig from './app.config';
import databaseConfig from './database.config';
import jwtConfig from './jwt.config';
import otpConfig from './otp.config';
import profileConfig from './profile.config';
import { awsConfig, firebaseConfig, redisConfig } from './integrations.config';

export { validateEnv } from './env.validation';
export { appConfig, databaseConfig, jwtConfig, otpConfig, profileConfig };

export const configLoaders = [
  appConfig,
  databaseConfig,
  jwtConfig,
  otpConfig,
  profileConfig,
  redisConfig,
  awsConfig,
  firebaseConfig,
];
