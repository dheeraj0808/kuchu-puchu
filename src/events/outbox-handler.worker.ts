import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { type Job, UnrecoverableError, Worker } from 'bullmq';

import { AlertProvider, errorClassOf } from '../infra/alerts/alert.provider';
import { QUEUE_CONNECTION, type QueueConnectionOptions } from '../infra/queue/queue-connection.module';
import { closeWorker } from '../jobs/close-worker';
import { sanitizeJobError } from '../jobs/job-errors';
import type { EventPayloads, EventType } from './event-types';
import { HandlerRegistry } from './handler-registry';
import { OUTBOX_HANDLER_CONCURRENCY, OUTBOX_QUEUE_NAME } from './outbox.constants';

/** Repeats of one (handler, error class) failure within this window are folded into one alert. */
export const HANDLER_ALERT_WINDOW_MS = 5 * 60_000;

/** BullMQ job data: one (event, handler) pair. The job name is the handler name. */
export type OutboxJobData = {
  [T in EventType]: { outboxId: string; eventType: T; aggregateId: string; payload: EventPayloads[T] };
}[EventType];

/**
 * Runs outbox handlers in the worker process. BullMQ owns handler retries
 * (attempts and exponential backoff are set per job by the relay); after the
 * last attempt the job stays in the failed set and an alert fires.
 */
@Injectable()
export class OutboxHandlerWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxHandlerWorker.name);
  private worker?: Worker<OutboxJobData>;
  private readonly alertWindows = new Map<string, { until: number; held: number }>();

  constructor(
    private readonly registry: HandlerRegistry,
    private readonly alerts: AlertProvider,
    @Inject(QUEUE_CONNECTION) private readonly connection: QueueConnectionOptions,
  ) {}

  /** After every module's onModuleInit, so all handlers are registered. */
  async onApplicationBootstrap(): Promise<void> {
    await this.start();
  }

  async start(): Promise<void> {
    if (this.worker) return;
    this.registry.seal();
    const worker = new Worker<OutboxJobData>(OUTBOX_QUEUE_NAME, (job) => this.process(job), {
      ...this.connection,
      concurrency: OUTBOX_HANDLER_CONCURRENCY,
    });
    worker.on('failed', (job, err) => this.onFailed(job, err));
    // A job stalled past maxStalledCount is failed on its next pickup (BullMQ's
    // deferred failure, UnrecoverableError), which alerts through onFailed.
    worker.on('stalled', (jobId) => this.logger.warn({ jobId }, 'Outbox handler job stalled; it goes back to the queue'));
    worker.on('error', (err) => this.logger.error({ err: errorClassOf(err) }, 'Outbox worker error'));
    this.worker = worker;
    // A worker closed before it is ready leaves BullMQ timers running for 30 s.
    await worker.waitUntilReady();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await closeWorker(this.worker, this.logger);
  }

  private async process(job: Job<OutboxJobData>): Promise<void> {
    const handler = this.registry.get(job.name);
    if (!handler || handler.eventType !== job.data.eventType) {
      throw new UnrecoverableError('No handler registered for this job');
    }
    try {
      await handler.handle({
        outboxId: job.data.outboxId,
        type: job.data.eventType,
        aggregateId: job.data.aggregateId,
        payload: job.data.payload,
        attempt: job.attemptsMade + 1,
      });
    } catch (err) {
      throw sanitizeJobError(err);
    }
  }

  /**
   * One alert per (handler, error class) per window, so a broken handler on a
   * busy event cannot flood the channel. Failures held back are counted into
   * the next alert for that pair; every failure is still logged.
   */
  private takeAlertSlot(key: string): number | null {
    const now = Date.now();
    const slot = this.alertWindows.get(key);
    if (slot && now < slot.until) {
      slot.held++;
      return null;
    }
    this.alertWindows.set(key, { until: now + HANDLER_ALERT_WINDOW_MS, held: 0 });
    return 1 + (slot?.held ?? 0);
  }

  private onFailed(job: Job<OutboxJobData> | undefined, err: Error): void {
    if (!job) return;
    const final = err.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);
    const fields = {
      handler: job.name,
      eventType: job.data.eventType,
      outboxId: job.data.outboxId,
      attempt: job.attemptsMade,
      err: errorClassOf(err),
    };
    if (!final) {
      this.logger.warn(fields, 'Outbox handler failed; it will be retried');
      return;
    }
    this.logger.error(fields, 'Outbox handler failed after its last attempt');
    const errorClass = errorClassOf(err);
    const count = this.takeAlertSlot(`${job.name}:${errorClass}`);
    if (count === null) return;
    // Not awaited: the provider never throws and has its own timeout.
    void this.alerts.send({
      kind: 'outbox_handler_failed',
      eventType: job.data.eventType,
      outboxId: job.data.outboxId,
      handler: job.name,
      ...(count > 1 ? { count } : {}),
      errorClass,
    });
  }
}
