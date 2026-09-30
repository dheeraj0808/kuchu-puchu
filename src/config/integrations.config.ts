import { registerAs } from '@nestjs/config';

import { envInt, envString } from './env.helpers';

// Placeholders for upcoming integrations. Not consumed yet.
export const redisConfig = registerAs('redis', () => ({
  host: envString('REDIS_HOST'),
  port: envInt('REDIS_PORT', 6379),
  password: envString('REDIS_PASSWORD'),
}));

export const awsConfig = registerAs('aws', () => ({
  region: envString('AWS_REGION'),
  accessKeyId: envString('AWS_ACCESS_KEY_ID'),
  secretAccessKey: envString('AWS_SECRET_ACCESS_KEY'),
  s3Bucket: envString('AWS_S3_BUCKET'),
}));

export const firebaseConfig = registerAs('firebase', () => ({
  projectId: envString('FIREBASE_PROJECT_ID'),
  clientEmail: envString('FIREBASE_CLIENT_EMAIL'),
  privateKey: envString('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
}));
