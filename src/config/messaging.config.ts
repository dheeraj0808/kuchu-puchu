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
  /** Share (%) of dailyBudget for identifiers no account holds; the rest is the existing-account reserve. */
  newIdentifierPercent: number;
}

export interface EmailConfig {
  /** SES when both are set (always in production), otherwise the fake. */
  from: string | undefined;
  sesRegion: string | undefined;
  /** OTP emails per IST calendar day across all users. */
  dailyBudget: number;
}

export const smsConfig = registerAs('sms', (): SmsConfig => {
  const env = getValidatedEnv();
  return {
    provider: env.SMS_PROVIDER ?? 'fake',
    apiKey: env.SMS_API_KEY,
    senderId: env.SMS_SENDER_ID,
    dltTemplateId: env.SMS_DLT_TEMPLATE_ID,
    dailyBudget: env.SMS_DAILY_BUDGET,
    newIdentifierPercent: env.SMS_BUDGET_NEW_IDENTIFIER_PERCENT,
  };
});

export const emailConfig = registerAs('email', (): EmailConfig => {
  const env = getValidatedEnv();
  return { from: env.EMAIL_FROM, sesRegion: env.SES_REGION, dailyBudget: env.EMAIL_DAILY_BUDGET };
});
