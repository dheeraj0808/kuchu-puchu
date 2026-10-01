import { registerAs } from '@nestjs/config';

import { Environment, getValidatedEnv } from './env.validation';

export interface OtpConfig {
  hashSecret: string;
  length: number;
  ttlSeconds: number;
  maxAttempts: number;
  resendCooldownSeconds: number;
  maxRequestsPerHour: number;
  maxRequestsPerIpPerHour: number;
  /** Calling codes such as "+91" that may receive SMS codes. */
  smsAllowedCountries: string[];
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
    maxRequestsPerIpPerHour: env.OTP_MAX_PER_IP_PER_HOUR,
    smsAllowedCountries: env.OTP_SMS_ALLOWED_COUNTRIES.split(','),
    // Never allowed in production (also rejected by validateEnv).
    devEcho: env.NODE_ENV !== Environment.Production && env.OTP_DEV_ECHO,
  };
});
