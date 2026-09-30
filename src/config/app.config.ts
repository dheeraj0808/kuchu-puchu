import { registerAs } from '@nestjs/config';

import { envBool, envInt, envList, envString } from './env.helpers';

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  corsOrigins: string[];
  trustProxy: string | undefined;
  logLevel: string;
  swaggerEnabled: boolean;
}

export default registerAs('app', (): AppConfig => {
  const nodeEnv = envString('NODE_ENV', 'development');
  const isProduction = nodeEnv === 'production';
  return {
    nodeEnv,
    isProduction,
    port: envInt('PORT', 3000),
    corsOrigins: envList('CORS_ORIGINS'),
    trustProxy: process.env.TRUST_PROXY || undefined,
    logLevel: envString('LOG_LEVEL', isProduction ? 'info' : 'debug'),
    swaggerEnabled: envBool('SWAGGER_ENABLED', !isProduction),
  };
});
