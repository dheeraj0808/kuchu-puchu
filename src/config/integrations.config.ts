import { registerAs } from '@nestjs/config';

import { getValidatedEnv } from './env.validation';

export interface RedisConfig {
  url: string | undefined;
  tls: boolean;
}

export const redisConfig = registerAs('redis', (): RedisConfig => {
  const env = getValidatedEnv();
  return { url: env.REDIS_URL, tls: env.REDIS_TLS };
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
