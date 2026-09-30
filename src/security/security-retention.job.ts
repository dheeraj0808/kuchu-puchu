import { Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import type { SecurityConfig } from '../config/security.config';
import type { JobSchedule, PeriodicJob } from '../jobs/periodic-job';
import { PeriodicJobRegistry } from '../jobs/periodic-job';

// admin.* is matched as a prefix; `_` is a LIKE wildcard, `.` is not, so the pattern is exact.
const DELETE_NON_ADMIN = `
  DELETE FROM security_events
   WHERE created_at < NOW(3) - INTERVAL :days DAY
     AND event_type NOT LIKE 'admin.%'
   ORDER BY created_at
   LIMIT :limit`;

const DELETE_ADMIN = `
  DELETE FROM security_events
   WHERE event_type LIKE 'admin.%'
     AND created_at < NOW(3) - INTERVAL :days DAY
   LIMIT :limit`;

/** Appendix B / M05: security-events retention, daily (21:45 UTC = 03:15 IST by default). */
@Injectable()
export class SecurityRetentionJob implements PeriodicJob {
  readonly name = 'security.retention';
  readonly schedule: JobSchedule;
  private readonly logger = new Logger(SecurityRetentionJob.name);
  private readonly cfg: SecurityConfig;

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<SecurityConfig>('security');
    this.schedule = { pattern: this.cfg.retentionCron };
  }

  async run(): Promise<void> {
    await this.deleteExpired();
  }

  /** Non-admin events older than retentionDays, admin.* older than adminRetentionDays, in batches. */
  async deleteExpired(cfg: SecurityConfig = this.cfg): Promise<{ deleted: number; adminDeleted: number }> {
    const deleted = await this.inBatches(DELETE_NON_ADMIN, cfg.retentionDays, cfg.retentionBatchSize);
    const adminDeleted = await this.inBatches(DELETE_ADMIN, cfg.adminRetentionDays, cfg.retentionBatchSize);
    this.logger.log({ deleted, adminDeleted }, 'Security events retention finished');
    return { deleted, adminDeleted };
  }

  private async inBatches(sql: string, days: number, limit: number): Promise<number> {
    let total = 0;
    for (;;) {
      const affected = await this.sequelize.query(sql, { replacements: { days, limit }, type: QueryTypes.BULKDELETE });
      total += affected;
      if (affected < limit) return total;
    }
  }
}

@Injectable()
class SecurityJobsRegistrar implements OnModuleInit {
  constructor(
    private readonly jobs: PeriodicJobRegistry,
    private readonly retention: SecurityRetentionJob,
  ) {}

  onModuleInit(): void {
    this.jobs.register(this.retention);
  }
}

/** Worker only: the security module's periodic jobs. */
@Module({ providers: [SecurityRetentionJob, SecurityJobsRegistrar] })
export class SecurityWorkerModule {}
