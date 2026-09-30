import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import type { OutboxConfig } from '../config/outbox.config';
import type { JobSchedule, PeriodicJob } from '../jobs/periodic-job';
import { OutboxRelayService } from './outbox-relay.service';
import { OUTBOX_CONFIG } from './outbox.constants';

/** Appendix B: outbox relay, every 1 s. */
@Injectable()
export class OutboxRelayJob implements PeriodicJob {
  readonly name = 'outbox.relay';
  readonly schedule: JobSchedule;

  constructor(
    private readonly relay: OutboxRelayService,
    @Inject(OUTBOX_CONFIG) cfg: OutboxConfig,
  ) {
    this.schedule = { every: cfg.relayIntervalMs };
  }

  async run(): Promise<void> {
    await this.relay.runOnce();
  }
}

/*
 * Only done rows, only past the age, in batches. The age is checked on both
 * timestamps: available_at (never earlier than created_at) lets MySQL
 * range-scan the (status, available_at) index, created_at keeps the rule exact.
 * Failed rows are never deleted; they wait for someone to act (replay → M15).
 */
const DELETE_DONE_BATCH = `
  DELETE FROM outbox_events
   WHERE status = 'done'
     AND available_at < NOW(3) - INTERVAL :days DAY
     AND created_at < NOW(3) - INTERVAL :days DAY
   ORDER BY available_at
   LIMIT :limit`;

/** Appendix B: outbox cleanup, daily (21:30 UTC = 03:00 IST by default). */
@Injectable()
export class OutboxCleanupJob implements PeriodicJob {
  readonly name = 'outbox.cleanup';
  readonly schedule: JobSchedule;
  private readonly logger = new Logger(OutboxCleanupJob.name);

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @Inject(OUTBOX_CONFIG) private readonly cfg: OutboxConfig,
  ) {
    this.schedule = { pattern: cfg.cleanupCron };
  }

  async run(): Promise<void> {
    await this.deleteExpired();
  }

  /** Deletes batch after batch until one is short. Returns the number of rows deleted. */
  async deleteExpired(): Promise<{ deleted: number; batches: number }> {
    let deleted = 0;
    let batches = 0;
    for (;;) {
      const affected = await this.sequelize.query(DELETE_DONE_BATCH, {
        replacements: { days: this.cfg.cleanupAgeDays, limit: this.cfg.cleanupBatchSize },
        type: QueryTypes.BULKDELETE,
      });
      batches++;
      deleted += affected;
      if (affected < this.cfg.cleanupBatchSize) break;
    }
    this.logger.log({ deleted, batches }, 'Outbox cleanup finished');
    return { deleted, batches };
  }
}
