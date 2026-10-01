import { Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import type { JobSchedule, PeriodicJob } from '../jobs/periodic-job';
import { PeriodicJobRegistry } from '../jobs/periodic-job';

/** Rows deleted per statement, so no DELETE holds locks for long. */
export const AUTH_CLEANUP_BATCH_SIZE = 5_000;

/** Appendix B: OTP codes older than 24 h. Hourly, at minute 7. */
export const OTP_CLEANUP_SCHEDULE: JobSchedule = { pattern: '7 * * * *' };
export const OTP_RETENTION_HOURS = 24;

/** Appendix B: sessions expired, or revoked more than 30 days ago. Daily at 21:00 UTC (02:30 IST). */
export const SESSION_CLEANUP_SCHEDULE: JobSchedule = { pattern: '0 21 * * *' };
export const REVOKED_SESSION_RETENTION_DAYS = 30;

const OTP_EXPIRED = `created_at < NOW(3) - INTERVAL ${OTP_RETENTION_HOURS} HOUR`;
const SESSION_EXPIRED = `(expires_at < NOW(3) OR absolute_expires_at < NOW(3) OR revoked_at < NOW(3) - INTERVAL ${REVOKED_SESSION_RETENTION_DAYS} DAY)`;

/**
 * Deletes matching rows in primary-key order, `batchSize` at a time. Each
 * batch is found with a plain (non-locking) read walking the primary key, then
 * deleted by id with the condition checked again, so only rows that still
 * match are removed and only those rows are locked.
 */
export async function deleteInBatches(
  sequelize: Sequelize,
  table: 'otp_verifications' | 'sessions',
  condition: string,
  batchSize: number,
): Promise<number> {
  let total = 0;
  let cursor = '';
  for (;;) {
    const rows = await sequelize.query<{ id: string }>(
      `SELECT id FROM ${table} WHERE id > :cursor AND ${condition} ORDER BY id LIMIT :limit`,
      { replacements: { cursor, limit: batchSize }, type: QueryTypes.SELECT },
    );
    if (rows.length === 0) return total;
    total += await sequelize.query(`DELETE FROM ${table} WHERE id IN (:ids) AND ${condition}`, {
      replacements: { ids: rows.map((r) => r.id) },
      type: QueryTypes.BULKDELETE,
    });
    if (rows.length < batchSize) return total;
    cursor = rows[rows.length - 1].id;
  }
}

@Injectable()
export class OtpCleanupJob implements PeriodicJob {
  readonly name = 'auth.otp_cleanup';
  readonly schedule = OTP_CLEANUP_SCHEDULE;
  private readonly logger = new Logger(OtpCleanupJob.name);

  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async run(): Promise<void> {
    await this.deleteExpired();
  }

  async deleteExpired(batchSize = AUTH_CLEANUP_BATCH_SIZE): Promise<number> {
    const deleted = await deleteInBatches(this.sequelize, 'otp_verifications', OTP_EXPIRED, batchSize);
    this.logger.log({ deleted }, 'OTP cleanup finished');
    return deleted;
  }
}

@Injectable()
export class SessionCleanupJob implements PeriodicJob {
  readonly name = 'auth.session_cleanup';
  readonly schedule = SESSION_CLEANUP_SCHEDULE;
  private readonly logger = new Logger(SessionCleanupJob.name);

  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async run(): Promise<void> {
    await this.deleteExpired();
  }

  async deleteExpired(batchSize = AUTH_CLEANUP_BATCH_SIZE): Promise<number> {
    const deleted = await deleteInBatches(this.sequelize, 'sessions', SESSION_EXPIRED, batchSize);
    this.logger.log({ deleted }, 'Session cleanup finished');
    return deleted;
  }
}

@Injectable()
class AuthJobsRegistrar implements OnModuleInit {
  constructor(
    private readonly jobs: PeriodicJobRegistry,
    private readonly otp: OtpCleanupJob,
    private readonly sessions: SessionCleanupJob,
  ) {}

  onModuleInit(): void {
    this.jobs.register(this.otp);
    this.jobs.register(this.sessions);
  }
}

/** Worker only: the auth module's periodic jobs (Appendix B). */
@Module({ providers: [OtpCleanupJob, SessionCleanupJob, AuthJobsRegistrar] })
export class AuthWorkerModule {}
