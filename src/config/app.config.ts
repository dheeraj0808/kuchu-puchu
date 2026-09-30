import { registerAs } from '@nestjs/config';

import { AppRole, Environment, getValidatedEnv, resolveAppRole } from './env.validation';

export interface AppConfig {
  nodeEnv: string;
  role: AppRole;
  sentryDsn: string | undefined;
  isProduction: boolean;
  port: number;
  corsOrigins: string[];
  trustProxy: string | undefined;
  logLevel: string;
  swaggerEnabled: boolean;
}

export default registerAs('app', (): AppConfig => {
  const env = getValidatedEnv();
  const isProduction = env.NODE_ENV === Environment.Production;
  return {
    nodeEnv: env.NODE_ENV,
    role: resolveAppRole(env),
    sentryDsn: env.SENTRY_DSN,
    isProduction,
    port: env.PORT,
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
    trustProxy: env.TRUST_PROXY || undefined,
    logLevel: env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
    swaggerEnabled: env.SWAGGER_ENABLED ?? !isProduction,
  };
});
