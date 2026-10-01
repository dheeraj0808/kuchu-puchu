import { registerAs } from '@nestjs/config';

import { getValidatedEnv } from './env.validation';

export interface SmsConfig {
  /** Provider name; only "fake" is implemented (the DLT provider comes later). */
  provider: string;
  apiKey: string | undefined;
  senderId: string | undefined;
  dltTemplateId: string | undefined;
  /** SMS codes per IST calendar day across all users. */
  dailyBudget: number;
}

export interface EmailConfig {
  /** SES when both are set (always in production), otherwise the fake. */
  from: string | undefined;
  sesRegion: string | undefined;
}

export const smsConfig = registerAs('sms', (): SmsConfig => {
  const env = getValidatedEnv();
  return {
    provider: env.SMS_PROVIDER ?? 'fake',
    apiKey: env.SMS_API_KEY,
    senderId: env.SMS_SENDER_ID,
    dltTemplateId: env.SMS_DLT_TEMPLATE_ID,
    dailyBudget: env.SMS_DAILY_BUDGET,
  };
});

export const emailConfig = registerAs('email', (): EmailConfig => {
  const env = getValidatedEnv();
  return { from: env.EMAIL_FROM, sesRegion: env.SES_REGION };
});
