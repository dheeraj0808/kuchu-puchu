import { registerAs } from '@nestjs/config';

import { getValidatedEnv } from './env.validation';

/** Rows deleted per statement by the outbox cleanup, so no DELETE holds locks for long. */
export const OUTBOX_CLEANUP_BATCH_SIZE = 5_000;

export interface OutboxConfig {
  /** How often the relay tick runs. */
  relayIntervalMs: number;
  /** A tick keeps taking batches until one comes back short or this runs out. */
  relayTimeBudgetMs: number;
  /** Rows per relay batch (SELECT … LIMIT). */
  batchSize: number;
  /** Relay failures before an event is marked failed; also BullMQ attempts per handler. */
  maxAttempts: number;
  /** Backoff base: relay retry after base × 2^attempts, handler retry after base × 2^(n-1). */
  backoffBaseMs: number;
  /** Longest the relay waits for Redis to accept a batch before counting a failure. */
  enqueueTimeoutMs: number;
  /** Done events older than this are deleted by the cleanup job. */
  cleanupAgeDays: number;
  /** Cron pattern (UTC) for the cleanup job. */
  cleanupCron: string;
  cleanupBatchSize: number;
  /** publish() rejects payloads larger than this (UTF-8 bytes of the JSON). */
  payloadMaxBytes: number;
  /** Completed handler jobs are kept this long; it is also the jobId dedupe window. */
  completedJobRetentionSeconds: number;
  /** Failed handler jobs are kept this long for inspection. */
  failedJobRetentionSeconds: number;
}

export default registerAs('outbox', (): OutboxConfig => {
  const env = getValidatedEnv();
  return {
    relayIntervalMs: env.OUTBOX_RELAY_INTERVAL_MS,
    relayTimeBudgetMs: env.OUTBOX_RELAY_TIME_BUDGET_MS,
    batchSize: env.OUTBOX_BATCH_SIZE,
    maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
    backoffBaseMs: env.OUTBOX_BACKOFF_BASE_MS,
    enqueueTimeoutMs: env.OUTBOX_ENQUEUE_TIMEOUT_MS,
    cleanupAgeDays: env.OUTBOX_CLEANUP_AGE_DAYS,
    cleanupCron: env.OUTBOX_CLEANUP_CRON,
    cleanupBatchSize: OUTBOX_CLEANUP_BATCH_SIZE,
    payloadMaxBytes: env.OUTBOX_PAYLOAD_MAX_BYTES,
    completedJobRetentionSeconds: env.OUTBOX_COMPLETED_JOB_RETENTION_HOURS * 3600,
    failedJobRetentionSeconds: env.OUTBOX_FAILED_JOB_RETENTION_DAYS * 86_400,
  };
});
