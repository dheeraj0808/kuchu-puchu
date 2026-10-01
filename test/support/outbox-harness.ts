import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/sequelize';
import { Queue } from 'bullmq';
import { Redis, type RedisOptions } from 'ioredis';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import type { OutboxConfig } from '../../src/config/outbox.config';
import { CoreModule } from '../../src/core.module';
import type { EventType } from '../../src/events/event-types';
import { EventsModule } from '../../src/events/events.module';
import { type DeliveredEvent, type EventHandler, HandlerRegistry } from '../../src/events/handler-registry';
import { OutboxHandlerWorker, type OutboxJobData } from '../../src/events/outbox-handler.worker';
import { OutboxRelayService } from '../../src/events/outbox-relay.service';
import { OUTBOX_QUEUE_NAME } from '../../src/events/outbox.constants';
import { OutboxService } from '../../src/events/outbox.service';
import { FakeAlertProvider } from '../../src/infra/alerts/fake-alert.provider';
import { QUEUE_PREFIX, type QueueConnectionOptions } from '../../src/infra/queue/queue-connection.module';
import { CaptureLogger } from './log-capture';

/** Small, fast values; each test overrides what it exercises. */
export function testOutboxConfig(overrides: Partial<OutboxConfig> = {}): OutboxConfig {
  return {
    relayIntervalMs: 1000,
    relayTimeBudgetMs: 5_000,
    batchSize: 200,
    maxAttempts: 8,
    backoffBaseMs: 10,
    enqueueTimeoutMs: 2_000,
    cleanupAgeDays: 7,
    cleanupCron: '30 21 * * *',
    cleanupBatchSize: 5_000,
    payloadMaxBytes: 16_384,
    completedJobRetentionSeconds: 3600,
    failedJobRetentionSeconds: 3600,
    ...overrides,
  };
}

/** A queue connection of its own, as a separate worker process would have. */
export function newQueueConnection(
  url = process.env.REDIS_URL as string,
  options: RedisOptions = {},
): QueueConnectionOptions {
  const connection = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true, ...options });
  connection.on('error', () => undefined);
  return { connection, prefix: QUEUE_PREFIX };
}

export async function closeConnection(options: QueueConnectionOptions): Promise<void> {
  await options.connection.quit().catch(() => options.connection.disconnect());
}

export function newOutboxQueue(options: QueueConnectionOptions): Queue<OutboxJobData> {
  const queue = new Queue<OutboxJobData>(OUTBOX_QUEUE_NAME, { ...options });
  queue.on('error', () => undefined);
  return queue;
}

export async function waitUntil(check: () => boolean | Promise<boolean>, timeoutMs = 15_000, what = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A handler that counts runs per (outboxId, handler) and can be told to fail. */
export class RecordingHandler<T extends EventType = EventType> implements EventHandler<T> {
  readonly runs = new Map<string, number>();
  readonly attempts: Array<{ outboxId: string; attempt: number; at: number }> = [];
  readonly payloads: unknown[] = [];

  constructor(
    readonly name: string,
    readonly eventType: T,
    private readonly behaviour: (event: DeliveredEvent<T>) => Promise<void> = async () => undefined,
  ) {}

  async handle(event: DeliveredEvent<T>): Promise<void> {
    this.attempts.push({ outboxId: event.outboxId, attempt: event.attempt, at: Date.now() });
    await this.behaviour(event);
    this.runs.set(event.outboxId, (this.runs.get(event.outboxId) ?? 0) + 1);
    this.payloads.push(event.payload);
  }

  get total(): number {
    let n = 0;
    for (const v of this.runs.values()) n += v;
    return n;
  }
}

/** Nest context with MySQL (CoreModule) and the publishing side of the outbox. */
export class OutboxHarness {
  private constructor(
    readonly moduleRef: TestingModule,
    readonly sequelize: Sequelize,
    readonly outbox: OutboxService,
  ) {}

  static async create(): Promise<OutboxHarness> {
    // Services built by hand use Nest's static Logger; it goes to the log capture (log-scan.ts), not the console.
    Logger.overrideLogger(new CaptureLogger());
    const moduleRef = await Test.createTestingModule({ imports: [CoreModule, EventsModule] }).compile();
    await moduleRef.init();
    return new OutboxHarness(moduleRef, moduleRef.get<Sequelize>(getConnectionToken()), moduleRef.get(OutboxService));
  }

  async close(): Promise<void> {
    await this.moduleRef.close();
  }

  async truncate(): Promise<void> {
    await this.sequelize.query('DELETE FROM outbox_events');
  }

  relay(queue: Queue<OutboxJobData>, registry: HandlerRegistry, alerts: FakeAlertProvider, cfg: OutboxConfig): OutboxRelayService {
    return new OutboxRelayService(this.sequelize, queue, registry, alerts, cfg);
  }

  async worker(registry: HandlerRegistry, alerts: FakeAlertProvider, connection: QueueConnectionOptions): Promise<OutboxHandlerWorker> {
    const worker = new OutboxHandlerWorker(registry, alerts, connection);
    await worker.start();
    return worker;
  }

  /** Publishes `count` events in one committed transaction; returns their ids. */
  async publishMany(count: number, aggregateId: string): Promise<string[]> {
    return this.sequelize.transaction(async (transaction) => {
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        ids.push(await this.outbox.publish('user.registered', aggregateId, { userId: aggregateId }, transaction));
      }
      return ids;
    });
  }

  async rows(): Promise<
    Array<{ id: string; event_type: string; status: string; attempts: number; last_error: string | null; due_in_ms: number }>
  > {
    const rows = await this.sequelize.query<{
      id: string | number;
      event_type: string;
      status: string;
      attempts: number;
      last_error: string | null;
      due_in_us: string | number;
    }>(
      `SELECT id, event_type, status, attempts, last_error, TIMESTAMPDIFF(MICROSECOND, NOW(3), available_at) AS due_in_us
         FROM outbox_events ORDER BY id`,
      { type: QueryTypes.SELECT },
    );
    return rows.map((r) => ({ ...r, id: String(r.id), due_in_ms: Number(r.due_in_us) / 1000 }));
  }
}
