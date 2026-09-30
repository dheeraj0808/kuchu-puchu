import { registerAs } from '@nestjs/config';

import { getValidatedEnv } from './env.validation';

/** Rows deleted per statement by the retention job, so no DELETE holds locks for long. */
export const SECURITY_RETENTION_BATCH_SIZE = 5_000;

export interface SecurityConfig {
  /** Keyed-hash secret for identifier prefixes (the OTP secret, so prefixes match OTP audit rows). */
  identifierHashSecret: string;
  /** Guide M05: 365 days for every event except admin.* */
  retentionDays: number;
  /** Guide M05: admin.* events are kept 3 years. */
  adminRetentionDays: number;
  /** Cron (UTC); 21:45 UTC = 03:15 IST. */
  retentionCron: string;
  retentionBatchSize: number;
}

export default registerAs('security', (): SecurityConfig => {
  const env = getValidatedEnv();
  return {
    identifierHashSecret: env.OTP_HASH_SECRET,
    retentionDays: env.SECURITY_EVENTS_RETENTION_DAYS,
    adminRetentionDays: env.SECURITY_EVENTS_ADMIN_RETENTION_DAYS,
    retentionCron: env.SECURITY_EVENTS_RETENTION_CRON,
    retentionBatchSize: SECURITY_RETENTION_BATCH_SIZE,
  };
});
