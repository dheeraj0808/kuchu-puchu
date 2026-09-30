import { registerAs } from '@nestjs/config';

import { Environment, getValidatedEnv } from './env.validation';

export interface OtpConfig {
  hashSecret: string;
  length: number;
  ttlSeconds: number;
  maxAttempts: number;
  resendCooldownSeconds: number;
  maxRequestsPerHour: number;
  devEcho: boolean;
}

export default registerAs('otp', (): OtpConfig => {
  const env = getValidatedEnv();
  return {
    hashSecret: env.OTP_HASH_SECRET,
    length: env.OTP_LENGTH,
    ttlSeconds: env.OTP_TTL_SECONDS,
    maxAttempts: env.OTP_MAX_ATTEMPTS,
    resendCooldownSeconds: env.OTP_RESEND_COOLDOWN_SECONDS,
    maxRequestsPerHour: env.OTP_MAX_PER_HOUR,
    // Never allowed in production (also rejected by validateEnv).
    devEcho: env.NODE_ENV !== Environment.Production && env.OTP_DEV_ECHO,
  };
});
