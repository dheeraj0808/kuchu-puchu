import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { type Job, Queue, UnrecoverableError, Worker } from 'bullmq';

import { errorClassOf } from '../infra/alerts/alert.provider';
import { QUEUE_CONNECTION, type QueueConnectionOptions } from '../infra/queue/queue-connection.module';
import { closeQueue, closeWorker } from './close-worker';
import { sanitizeJobError } from './job-errors';
import { type JobSchedule, PeriodicJobRegistry } from './periodic-job';

/** BullMQ queue for every periodic job; keys live under kp:queue:scheduled-jobs:… */
export const SCHEDULED_JOBS_QUEUE_NAME = 'scheduled-jobs';

export const JOB_SCHEDULER_OPTIONS = Symbol('JOB_SCHEDULER_OPTIONS');

export interface JobSchedulerOptions {
  /** Failed ticks are kept this long (and at most 1,000) for inspection. */
  failedJobRetentionSeconds: number;
}

/** Completed ticks kept for inspection. The relay alone runs 86,400 ticks a day. */
const COMPLETED_TICKS_KEPT = 100;
const FAILED_TICKS_KEPT = 1_000;

function repeatOptions(schedule: JobSchedule): { every: number } | { pattern: string; tz: string } {
  return 'every' in schedule ? { every: schedule.every } : { pattern: schedule.pattern, tz: 'UTC' };
}

/**
 * Runs Appendix B jobs as BullMQ job schedulers (guide M03). A scheduler
 * produces one job per tick in Redis, and only one worker can take a job,
 * so each tick runs exactly once however many worker processes exist.
 */
@Injectable()
export class JobSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobSchedulerService.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly registry: PeriodicJobRegistry,
    @Inject(QUEUE_CONNECTION) private readonly connection: QueueConnectionOptions,
    @Inject(JOB_SCHEDULER_OPTIONS) private readonly options: JobSchedulerOptions,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.start();
  }

  async start(): Promise<void> {
    if (this.worker) return;
    this.registry.seal();
    const jobs = this.registry.all();
    const queue = new Queue(SCHEDULED_JOBS_QUEUE_NAME, { ...this.connection });
    queue.on('error', (err) => this.logger.error({ err: errorClassOf(err) }, 'Scheduler queue error'));
    this.queue = queue;

    for (const job of jobs) {
      await queue.upsertJobScheduler(job.name, repeatOptions(job.schedule), {
        name: job.name,
        opts: {
          attempts: 1,
          stackTraceLimit: 0,
          removeOnComplete: { count: COMPLETED_TICKS_KEPT },
          removeOnFail: { age: this.options.failedJobRetentionSeconds, count: FAILED_TICKS_KEPT },
        },
      });
    }
    // A job that was removed from the code must stop ticking.
    const wanted = new Set(jobs.map((j) => j.name));
    for (const existing of await queue.getJobSchedulers()) {
      if (!wanted.has(existing.key)) {
        await queue.removeJobScheduler(existing.key);
        this.logger.warn({ job: existing.key }, 'Removed the scheduler of a job that is no longer registered');
      }
    }

    const worker = new Worker(SCHEDULED_JOBS_QUEUE_NAME, (job) => this.dispatch(job), {
      ...this.connection,
      // Enough slots that a long daily job never delays the 1 s relay. Two relay ticks may
      // then overlap in one process; SKIP LOCKED keeps that safe.
      concurrency: Math.max(1, jobs.length),
    });
    worker.on('failed', (job, err) =>
      this.logger.error({ job: job?.name, err: errorClassOf(err) }, 'Periodic job failed; the next tick runs as scheduled'),
    );
    worker.on('error', (err) => this.logger.error({ err: errorClassOf(err) }, 'Scheduler worker error'));
    this.worker = worker;
    // A worker closed before it is ready leaves BullMQ timers running for 30 s.
    await worker.waitUntilReady();
    this.logger.log(`Job schedulers registered: ${jobs.map((j) => j.name).join(', ') || 'none'}`);
  }

  /** Stops taking ticks, lets a running tick finish, then closes the queue. */
  async onModuleDestroy(): Promise<void> {
    if (this.worker) await closeWorker(this.worker, this.logger);
    if (this.queue) await closeQueue(this.queue);
  }

  private async dispatch(job: Job): Promise<void> {
    const periodic = this.registry.get(job.name);
    if (!periodic) throw new UnrecoverableError('No periodic job registered under this name');
    try {
      await periodic.run({ jobId: String(job.id), scheduledAt: job.timestamp });
    } catch (err) {
      throw sanitizeJobError(err);
    }
  }
}
