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

export interface AwsConfig {
  region: string;
  /** Private bucket (Block Public Access) for exports and other non-public files. */
  privateBucket: string | undefined;
  /** Local fake storage directory when S3 is not configured (development and test). */
  localStorageDir: string | undefined;
}

/** S3 when AWS_REGION and S3_BUCKET_PRIVATE are set (required in production), otherwise the local fake. */
export const awsConfig = registerAs('aws', (): AwsConfig => {
  const env = getValidatedEnv();
  return { region: env.AWS_REGION ?? '', privateBucket: env.S3_BUCKET_PRIVATE, localStorageDir: env.STORAGE_LOCAL_DIR };
});

// Placeholder for an upcoming integration. Not consumed yet.

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
