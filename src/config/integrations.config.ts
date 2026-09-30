import { registerAs } from '@nestjs/config';

import { getValidatedEnv } from './env.validation';

export const DEFAULT_DEV_REDIS_URL = 'redis://localhost:6379';

export interface RedisConfig {
  url: string;
  tls: boolean;
}

export const redisConfig = registerAs('redis', (): RedisConfig => {
  const env = getValidatedEnv();
  // validateEnv requires REDIS_URL in production, so the default only applies elsewhere.
  return { url: env.REDIS_URL ?? DEFAULT_DEV_REDIS_URL, tls: env.REDIS_TLS };
});

// Placeholders for upcoming integrations. Not consumed yet.
export const awsConfig = registerAs('aws', () => ({
  region: getValidatedEnv().AWS_REGION ?? '',
}));

export const fcmConfig = registerAs('fcm', () => {
  const env = getValidatedEnv();
  return {
    projectId: env.FCM_PROJECT_ID ?? '',
    clientEmail: env.FCM_CLIENT_EMAIL ?? '',
    privateKey: (env.FCM_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  };
});

export interface AlertsConfig {
  /** Unset outside production (validateEnv requires it there): alerts are then only logged. */
  webhookUrl: string | undefined;
  environment: string;
}

export const alertsConfig = registerAs('alerts', (): AlertsConfig => {
  const env = getValidatedEnv();
  return { webhookUrl: env.ALERT_WEBHOOK_URL, environment: env.NODE_ENV };
});
