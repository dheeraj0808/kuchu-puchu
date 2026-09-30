import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { OutboxConfig } from '../config/outbox.config';
import { JOB_SCHEDULER_OPTIONS, JobSchedulerService, type JobSchedulerOptions } from './job-scheduler.service';
import { PeriodicJobRegistry } from './periodic-job';

/** Worker only: the periodic-job registry and the BullMQ scheduler that runs it. */
@Global()
@Module({
  providers: [
    PeriodicJobRegistry,
    JobSchedulerService,
    {
      provide: JOB_SCHEDULER_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): JobSchedulerOptions => ({
        failedJobRetentionSeconds: config.getOrThrow<OutboxConfig>('outbox').failedJobRetentionSeconds,
      }),
    },
  ],
  exports: [PeriodicJobRegistry],
})
export class JobsModule {}
