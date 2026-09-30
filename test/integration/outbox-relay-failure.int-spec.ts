import { randomUUID } from 'node:crypto';

import type { Queue } from 'bullmq';

import { HandlerRegistry } from '../../src/events/handler-registry';
import type { OutboxJobData } from '../../src/events/outbox-handler.worker';
import { FakeAlertProvider } from '../../src/infra/alerts/fake-alert.provider';
import { closeQueue } from '../../src/jobs/close-worker';
import type { QueueConnectionOptions } from '../../src/infra/queue/queue-connection.module';
import {
  OutboxHarness,
  RecordingHandler,
  closeConnection,
  newOutboxQueue,
  newQueueConnection,
  testOutboxConfig,
  waitUntil,
} from '../support/outbox-harness';
import { clearTestKeys } from '../support/test-redis';

/** Nothing listens on port 1. Retries are capped so no reconnect timer outlives the test. */
const DEAD_REDIS = 'redis://127.0.0.1:1/15';

describe('Outbox relay when Redis is down', () => {
  let h: OutboxHarness;
  let alerts: FakeAlertProvider;
  let registry: HandlerRegistry;
  let deadConnection: QueueConnectionOptions;
  let deadQueue: Queue<OutboxJobData>;

  beforeAll(async () => {
    h = await OutboxHarness.create();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await h.truncate();
    await clearTestKeys(process.env.REDIS_URL as string);
    alerts = new FakeAlertProvider();
    registry = new HandlerRegistry();
    registry.register(new RecordingHandler('test.down', 'user.registered'));
    deadConnection = newQueueConnection(DEAD_REDIS, { retryStrategy: (n) => (n > 3 ? null : 50), disconnectTimeout: 20 });
    deadQueue = newOutboxQueue(deadConnection);
  });

  afterEach(async () => {
    // End the connection first so BullMQ stops waiting for it; closeQueue bounds the rest.
    deadConnection.connection.disconnect();
    await closeQueue(deadQueue, 100);
  });

  /** Makes every pending row due now, instead of waiting out the real backoff. */
  const makeDue = (): Promise<unknown> =>
    h.sequelize.query(`UPDATE outbox_events SET available_at = NOW(3) - INTERVAL 1 SECOND WHERE status = 'pending'`);

  it('updates attempts, available_at (now + 2^attempts s) and last_error; after 8 attempts → failed + one alert', async () => {
    // Default backoff base (1 s), so available_at must be now + 2^attempts seconds.
    const cfg = testOutboxConfig({ maxAttempts: 8, backoffBaseMs: 1000, enqueueTimeoutMs: 100 });
    const relay = h.relay(deadQueue, registry, alerts, cfg);
    const [id, second] = await h.publishMany(2, randomUUID());
    let lastError = '';

    for (let attempt = 1; attempt <= 8; attempt++) {
      const result = await relay.runOnce();
      expect(result).toEqual(
        attempt < 8
          ? { batches: 1, relayed: 0, retried: 2, failed: 0 }
          : { batches: 1, relayed: 0, retried: 0, failed: 2 },
      );
      for (const row of await h.rows()) {
        expect(row.attempts).toBe(attempt);
        // The class (and a safe code) of whatever Redis failed with; never its message.
        expect(row.last_error).toMatch(/^[A-Za-z]*Error( \([A-Z0-9_]+\))?$/);
        lastError = row.last_error as string;
        expect(row.status).toBe(attempt < 8 ? 'pending' : 'failed');
        const expectedMs = 2 ** attempt * 1000;
        expect(row.due_in_ms).toBeLessThanOrEqual(expectedMs);
        expect(row.due_in_ms).toBeGreaterThan(expectedMs - 1500);
      }
      if (attempt < 8) expect(alerts.sent).toEqual([]);
      // Not due yet: a tick right now leaves the rows alone.
      if (attempt === 1) expect(await relay.runOnce()).toMatchObject({ batches: 0 });
      await makeDue();
    }

    const errorClass = lastError.split(' ')[0];
    // One alert for the batch (first id + count), not one per event.
    expect(second).not.toBe(id);
    expect(alerts.sent).toEqual([
      { kind: 'outbox_relay_failed', eventType: 'user.registered', outboxId: id, count: 2, errorClass },
    ]);
    // Failed rows are never picked again, even by a healthy relay.
    const healthyConnection = newQueueConnection();
    const healthyQueue = newOutboxQueue(healthyConnection);
    try {
      expect(await h.relay(healthyQueue, registry, alerts, cfg).runOnce()).toMatchObject({ batches: 0 });
    } finally {
      await healthyQueue.close();
      await closeConnection(healthyConnection);
    }
    expect(alerts.sent).toHaveLength(1);
  });

  it('an event that failed to relay is delivered once Redis is back, keeping its attempt count', async () => {
    const cfg = testOutboxConfig({ enqueueTimeoutMs: 100 });
    await h.publishMany(1, randomUUID());
    await h.relay(deadQueue, registry, alerts, cfg).runOnce();
    await makeDue();
    await h.relay(deadQueue, registry, alerts, cfg).runOnce();
    await makeDue();

    const healthyConnection = newQueueConnection();
    const healthyQueue = newOutboxQueue(healthyConnection);
    const handler = new RecordingHandler('test.recovered', 'user.registered');
    const recovered = new HandlerRegistry();
    recovered.register(handler);
    const workerConnection = newQueueConnection();
    const worker = await h.worker(recovered, alerts, workerConnection);
    try {
      expect(await h.relay(healthyQueue, recovered, alerts, cfg).runOnce()).toMatchObject({ relayed: 1 });
      await waitUntil(() => handler.total === 1, 10_000, 'the handler');
      expect(await h.rows()).toEqual([
        expect.objectContaining({ status: 'done', attempts: 2, last_error: expect.stringMatching(/Error/) }),
      ]);
      expect(alerts.sent).toEqual([]);
    } finally {
      await worker.onModuleDestroy();
      await healthyQueue.close();
      await closeConnection(healthyConnection);
      await closeConnection(workerConnection);
    }
  });

  it('a Redis that accepts the connection but never answers counts as a failure after the enqueue timeout', async () => {
    const cfg = testOutboxConfig({ enqueueTimeoutMs: 150 });
    const connection = newQueueConnection();
    const hanging = newOutboxQueue(connection);
    hanging.addBulk = () => new Promise(() => undefined);
    try {
      const [id] = await h.publishMany(1, randomUUID());
      const started = Date.now();
      expect(await h.relay(hanging, registry, alerts, cfg).runOnce()).toMatchObject({ retried: 1 });
      expect(Date.now() - started).toBeGreaterThanOrEqual(140);
      expect(await h.rows()).toEqual([
        expect.objectContaining({ id, status: 'pending', attempts: 1, last_error: 'OutboxEnqueueTimeoutError' }),
      ]);
    } finally {
      await hanging.close();
      await closeConnection(connection);
    }
  });

  it('a row not written by publish() (bad type or payload) is marked failed without stalling the rows behind it', async () => {
    const connection = newQueueConnection();
    const queue = newOutboxQueue(connection);
    try {
      await h.sequelize.query(
        `INSERT INTO outbox_events (event_type, aggregate_id, payload) VALUES ('user.registered', UUID(), '"x"'), ('no.such_event', UUID(), '{}')`,
      );
      const [good] = await h.publishMany(1, randomUUID());
      expect(await h.relay(queue, registry, alerts, testOutboxConfig()).runOnce()).toMatchObject({ relayed: 1, failed: 2 });
      const rows = await h.rows();
      expect(rows.map((r) => [r.status, r.last_error])).toEqual([
        ['failed', 'OutboxInvalidRow'],
        ['failed', 'OutboxInvalidRow'],
        ['done', null],
      ]);
      expect(rows[2].id).toBe(good);
      await waitUntil(() => alerts.sent.length === 1, 2_000, 'the alert');
      expect(alerts.sent[0]).toMatchObject({ kind: 'outbox_relay_failed', eventType: 'mixed', count: 2, errorClass: 'OutboxInvalidRow' });
    } finally {
      await queue.close();
      await closeConnection(connection);
    }
  });
});
