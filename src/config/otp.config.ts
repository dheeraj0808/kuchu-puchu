import { registerAs } from '@nestjs/config';

import { envBool, envInt, envString } from './env.helpers';

export interface OtpConfig {
  hashSecret: string;
  length: number;
  ttlSeconds: number;
  maxAttempts: number;
  resendCooldownSeconds: number;
  maxRequestsPerHour: number;
  devEcho: boolean;
}

export default registerAs(
  'otp',
  (): OtpConfig => ({
    hashSecret: envString('OTP_HASH_SECRET'),
    length: envInt('OTP_LENGTH', 6),
    ttlSeconds: envInt('OTP_TTL_SECONDS', 300),
    maxAttempts: envInt('OTP_MAX_ATTEMPTS', 5),
    resendCooldownSeconds: envInt('OTP_RESEND_COOLDOWN_SECONDS', 60),
    maxRequestsPerHour: envInt('OTP_MAX_REQUESTS_PER_HOUR', 5),
    // Never allowed in production (enforced in env.validation.ts).
    devEcho:
      envString('NODE_ENV') !== 'production' && envBool('OTP_DEV_ECHO', false),
  }),
);
