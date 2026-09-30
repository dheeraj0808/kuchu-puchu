import { Injectable } from '@nestjs/common';

/** `every` in ms, or a 5-field cron `pattern` evaluated in UTC. */
export type JobSchedule = { every: number } | { pattern: string };

export interface JobRunContext {
  /** BullMQ job id of this tick; unique per tick. */
  jobId: string;
  /** When BullMQ created the tick (ms since epoch). */
  scheduledAt: number;
}

/**
 * A background job from Appendix B. Each tick is one BullMQ job, so exactly
 * one worker runs it however many worker processes exist. A tick that
 * throws is logged and not retried; the next tick runs as scheduled.
 */
export interface PeriodicJob {
  /** Unique; `[a-z0-9_.]`, max 64. Also the BullMQ job scheduler id. */
  readonly name: string;
  readonly schedule: JobSchedule;
  run(ctx: JobRunContext): Promise<void>;
}

export const PERIODIC_JOB_NAME = /^[a-z0-9_.]{1,64}$/;

/** Modules register their periodic jobs from onModuleInit; the scheduler seals it at bootstrap. */
@Injectable()
export class PeriodicJobRegistry {
  private readonly jobs = new Map<string, PeriodicJob>();
  private sealed = false;

  register(job: PeriodicJob): void {
    if (this.sealed) throw new Error(`Periodic job "${job.name}" registered after the scheduler started`);
    if (typeof job.name !== 'string' || !PERIODIC_JOB_NAME.test(job.name)) {
      throw new Error(`Invalid periodic job name "${String(job.name)}": use [a-z0-9_.], 1–64 chars`);
    }
    if (this.jobs.has(job.name)) throw new Error(`Duplicate periodic job "${job.name}"`);
    this.jobs.set(job.name, job);
  }

  get(name: string): PeriodicJob | undefined {
    return this.jobs.get(name);
  }

  all(): PeriodicJob[] {
    return [...this.jobs.values()];
  }

  seal(): void {
    this.sealed = true;
  }
}
