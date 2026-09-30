import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import type { JobsOptions, Queue } from 'bullmq';
import { QueryTypes, Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import type { OutboxConfig } from '../config/outbox.config';
import { type Alert, AlertProvider, errorClassOf } from '../infra/alerts/alert.provider';
import { closeQueue } from '../jobs/close-worker';
import { isEventType } from './event-types';
import { HandlerRegistry } from './handler-registry';
import type { OutboxJobData } from './outbox-handler.worker';
import { OUTBOX_CONFIG, OUTBOX_QUEUE, outboxJobId } from './outbox.constants';

interface PendingRow {
  id: string | number;
  event_type: string;
  aggregate_id: string;
  payload: unknown;
  attempts: number;
}

interface BatchResult {
  selected: number;
  relayed: number;
  retried: number;
  failed: number;
  enqueueFailed: boolean;
}

export interface RelayResult {
  batches: number;
  relayed: number;
  retried: number;
  failed: number;
}

type OutboxJob = { name: string; data: OutboxJobData; opts: JobsOptions };

/** Redis did not accept the batch in time. */
export class OutboxEnqueueTimeoutError extends Error {
  override readonly name = 'OutboxEnqueueTimeoutError';
}

/** The producer connection is not ready, so nothing is sent (and nothing is queued in memory). */
export class OutboxRedisUnavailableError extends Error {
  override readonly name = 'OutboxRedisUnavailableError';
}

/** Failed handler jobs kept at most (on top of the age limit), so a broken handler cannot fill Redis. */
export const FAILED_HANDLER_JOBS_KEPT = 10_000;

/** Longest shutdown waits for an in-flight tick (budget: see WORKER_DRAIN_TIMEOUT_MS). */
export const RELAY_STOP_TIMEOUT_MS = 1_500;

const INVALID_ROW_ERROR = 'OutboxInvalidRow';

/** ioredis states in which a command cannot be sent now. */
const DOWN_STATUSES = new Set(['reconnecting', 'close', 'end']);

/** Floor for the budget-capped enqueue wait: a healthy addBulk takes a few ms. */
const MIN_ENQUEUE_TIMEOUT_MS = 100;

const SELECT_PENDING = `
  SELECT id, event_type, aggregate_id, payload, attempts
    FROM outbox_events
   WHERE status = 'pending' AND available_at <= NOW(3)
   ORDER BY id
   LIMIT :limit
   FOR UPDATE SKIP LOCKED`;

const MARK_DONE = `UPDATE outbox_events SET status = 'done' WHERE id IN (:ids)`;

const MARK_INVALID = `UPDATE outbox_events SET status = 'failed', last_error = :lastError WHERE id IN (:ids)`;

// MySQL applies SET assignments left to right, so attempts is incremented
// last and the expressions before it see the old value.
const MARK_RETRY = `
  UPDATE outbox_events
     SET status = IF(attempts + 1 >= :maxAttempts, 'failed', 'pending'),
         available_at = NOW(3) + INTERVAL CAST(:backoffBaseMs * 1000 * POW(2, attempts + 1) AS UNSIGNED) MICROSECOND,
         last_error = :lastError,
         attempts = attempts + 1
   WHERE id IN (:ids)`;

/** "RedisConnectionError (ECONNREFUSED)". Error messages are not stored: they can hold hosts or data. */
export function describeRelayError(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  const suffix = typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code) ? ` (${code})` : '';
  return `${errorClassOf(err)}${suffix}`.slice(0, 500);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Moves committed outbox rows into BullMQ (guide M03). Runs only in the
 * worker, as the `outbox.relay` periodic job.
 *
 * Each batch is one READ COMMITTED transaction (no gap locks, so publishers
 * are never blocked by a relay waiting on Redis): lock up to batchSize due
 * rows with SKIP LOCKED (so concurrent relays never take the same row),
 * enqueue one job per registered handler with jobId `<outboxId>-<handlerName>`,
 * mark the rows done, commit. A crash between enqueue and commit rolls the
 * rows back to pending; the next run enqueues them again and BullMQ drops the
 * duplicate jobIds. If Redis refuses the batch, the rows get attempts + 1,
 * last_error and a backoff of base × 2^attempts; at maxAttempts they become
 * failed and one alert fires for the batch.
 */
@Injectable()
export class OutboxRelayService implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private readonly inFlight = new Set<Promise<RelayResult>>();
  private stopping = false;

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @Inject(OUTBOX_QUEUE) private readonly queue: Queue<OutboxJobData>,
    private readonly registry: HandlerRegistry,
    private readonly alerts: AlertProvider,
    @Inject(OUTBOX_CONFIG) private readonly cfg: OutboxConfig,
  ) {}

  /**
   * One relay tick: takes batches until one comes back short, Redis fails,
   * or the time budget runs out, so a tick ends before the next one is due.
   */
  runOnce(): Promise<RelayResult> {
    if (this.stopping) return Promise.resolve({ batches: 0, relayed: 0, retried: 0, failed: 0 });
    const run = this.drain();
    this.inFlight.add(run);
    const forget = (): void => {
      this.inFlight.delete(run);
    };
    run.then(forget, forget);
    return run;
  }

  /** Lets an in-flight tick commit (bounded), then closes the queue. Later ticks do nothing. */
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled(this.inFlight),
      new Promise((resolve) => {
        timer = setTimeout(resolve, RELAY_STOP_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
    await closeQueue(this.queue);
    // The producer connection belongs to this queue (see EventsWorkerModule).
    const connection = this.queue.opts.connection as { quit?: () => Promise<unknown>; disconnect?: () => void };
    if (connection.quit) {
      await closeQueue({ close: async () => void (await connection.quit?.()) });
      connection.disconnect?.();
    }
  }

  /** Test seam: runs after the jobs are in Redis and before the rows are marked done. */
  protected async afterEnqueue(): Promise<void> {}

  private async drain(): Promise<RelayResult> {
    const deadline = Date.now() + this.cfg.relayTimeBudgetMs;
    const total: RelayResult = { batches: 0, relayed: 0, retried: 0, failed: 0 };
    for (;;) {
      const batch = await this.relayBatch(deadline);
      if (batch.selected > 0) total.batches++;
      total.relayed += batch.relayed;
      total.retried += batch.retried;
      total.failed += batch.failed;
      if (batch.selected < this.cfg.batchSize || batch.enqueueFailed) break;
      if (this.stopping || Date.now() >= deadline) break;
    }
    return total;
  }

  private async relayBatch(deadline: number): Promise<BatchResult> {
    const alerts: Alert[] = [];
    const result = await this.sequelize.transaction(
      { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED },
      async (transaction) => {
        const rows = await this.sequelize.query<PendingRow>(SELECT_PENDING, {
          replacements: { limit: this.cfg.batchSize },
          type: QueryTypes.SELECT,
          transaction,
        });
        const result: BatchResult = { selected: rows.length, relayed: 0, retried: 0, failed: 0, enqueueFailed: false };
        if (rows.length === 0) return result;

        // A row not written by publish() must not stall the relay for everyone behind it.
        const invalid = rows.filter((r) => !isEventType(r.event_type) || !isPlainObject(r.payload));
        const valid = rows.filter((r) => !invalid.includes(r));
        if (invalid.length > 0) {
          await this.sequelize.query(MARK_INVALID, {
            replacements: { ids: invalid.map((r) => String(r.id)), lastError: INVALID_ROW_ERROR },
            transaction,
          });
          alerts.push(this.batchAlert(invalid, INVALID_ROW_ERROR));
          result.failed += invalid.length;
        }
        if (valid.length === 0) return result;

        const ids = valid.map((r) => String(r.id));
        const jobs = this.buildJobs(valid);
        if (jobs.length > 0) {
          try {
            await this.enqueue(jobs, this.enqueueTimeout(deadline));
          } catch (err) {
            const failure = await this.recordFailure(valid, ids, err, transaction, alerts);
            return { ...result, ...failure, failed: result.failed + failure.failed };
          }
          await this.afterEnqueue();
        }
        await this.sequelize.query(MARK_DONE, { replacements: { ids }, transaction });
        return { ...result, relayed: valid.length };
      },
    );
    // After the commit, and not awaited: a slow alert channel must not stall the relay.
    // The provider never throws and has its own timeout.
    for (const alert of alerts) void this.alerts.send(alert);
    return result;
  }

  private buildJobs(rows: PendingRow[]): OutboxJob[] {
    const jobs: OutboxJob[] = [];
    const unhandled = new Set<string>();
    for (const row of rows) {
      const handlers = this.registry.handlersFor(row.event_type);
      if (handlers.length === 0) unhandled.add(row.event_type);
      const outboxId = String(row.id);
      // mysql2 already parses JSON columns.
      const data = { outboxId, eventType: row.event_type, aggregateId: row.aggregate_id, payload: row.payload } as OutboxJobData;
      for (const handler of handlers) {
        jobs.push({ name: handler.name, data, opts: { ...this.jobOptions(), jobId: outboxJobId(outboxId, handler.name) } });
      }
    }
    for (const eventType of unhandled) {
      this.logger.warn({ eventType }, 'No handler registered for this event type; marking its events done');
    }
    return jobs;
  }

  private jobOptions(): JobsOptions {
    return {
      attempts: this.cfg.maxAttempts,
      backoff: { type: 'exponential', delay: this.cfg.backoffBaseMs },
      removeOnComplete: { age: this.cfg.completedJobRetentionSeconds },
      removeOnFail: { age: this.cfg.failedJobRetentionSeconds, count: FAILED_HANDLER_JOBS_KEPT },
      // Handler errors are already reduced to their class (see OutboxHandlerWorker); keep no stacks in Redis.
      stackTraceLimit: 0,
    };
  }

  /** The enqueue wait never runs past the tick's budget, so a tick ends before the next is due. */
  private enqueueTimeout(deadline: number): number {
    return Math.max(MIN_ENQUEUE_TIMEOUT_MS, Math.min(this.cfg.enqueueTimeoutMs, deadline - Date.now()));
  }

  /**
   * Sends the batch only when the connection is ready. The producer connection
   * has no offline queue, so a batch is never parked in memory and sent after
   * the rows were already counted as failed. If the add has not started when
   * the timeout fires, it never starts.
   */
  private async enqueue(jobs: OutboxJob[], timeoutMs: number): Promise<void> {
    let abandoned = false;
    const send = (async (): Promise<void> => {
      const connection = this.queue.opts.connection as { status?: string };
      // Fail fast only when the connection is known to be down; one that is still
      // connecting (or lazy, 'wait') gets up to the enqueue timeout.
      if (connection.status !== undefined && DOWN_STATUSES.has(connection.status)) {
        throw new OutboxRedisUnavailableError('Redis connection not ready');
      }
      await this.queue.waitUntilReady();
      if (abandoned) return;
      await this.queue.addBulk(jobs);
    })();
    send.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abandoned = true;
        reject(new OutboxEnqueueTimeoutError('enqueue timed out'));
      }, timeoutMs);
    });
    try {
      await Promise.race([send, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async recordFailure(
    rows: PendingRow[],
    ids: string[],
    err: unknown,
    transaction: Transaction,
    alerts: Alert[],
  ): Promise<BatchResult> {
    const lastError = describeRelayError(err);
    await this.sequelize.query(MARK_RETRY, {
      replacements: { ids, lastError, maxAttempts: this.cfg.maxAttempts, backoffBaseMs: this.cfg.backoffBaseMs },
      transaction,
    });
    const failed = rows.filter((r) => Number(r.attempts) + 1 >= this.cfg.maxAttempts);
    if (failed.length > 0) alerts.push(this.batchAlert(failed, errorClassOf(err)));
    this.logger.error(
      { events: rows.length, failed: failed.length, err: lastError },
      'Outbox relay could not enqueue a batch; it will be retried with backoff',
    );
    return { selected: rows.length, relayed: 0, retried: rows.length - failed.length, failed: failed.length, enqueueFailed: true };
  }

  /** One alert per batch: the first event's type and id, and how many events it covers. */
  private batchAlert(rows: PendingRow[], errorClass: string): Alert {
    const types = new Set(rows.map((r) => r.event_type));
    return {
      kind: 'outbox_relay_failed',
      eventType: types.size === 1 ? rows[0].event_type : 'mixed',
      outboxId: String(rows[0].id),
      count: rows.length,
      errorClass,
    };
  }
}
