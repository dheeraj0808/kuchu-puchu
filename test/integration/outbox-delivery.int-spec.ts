import { randomUUID } from 'node:crypto';

import type { JobsOptions, Queue } from 'bullmq';

import { HandlerRegistry } from '../../src/events/handler-registry';
import type { OutboxHandlerWorker, OutboxJobData } from '../../src/events/outbox-handler.worker';
import { OutboxRelayService } from '../../src/events/outbox-relay.service';
import { OutboxPublishError } from '../../src/events/outbox.service';
import { FakeAlertProvider } from '../../src/infra/alerts/fake-alert.provider';
import type { QueueConnectionOptions } from '../../src/infra/queue/queue-connection.module';
import {
  OutboxHarness,
  RecordingHandler,
  closeConnection,
  newOutboxQueue,
  newQueueConnection,
  sleep,
  testOutboxConfig,
  waitUntil,
} from '../support/outbox-harness';
import { clearTestKeys } from '../support/test-redis';

/** Records the jobIds of every addBulk call, to prove who enqueued what. */
function spyOnEnqueue(queue: Queue<OutboxJobData>): string[] {
  const jobIds: string[] = [];
  const original = queue.addBulk.bind(queue);
  queue.addBulk = (jobs: Array<{ name: string; data: OutboxJobData; opts?: JobsOptions }>) => {
    for (const j of jobs) jobIds.push(String(j.opts?.jobId));
    return original(jobs);
  };
  return jobIds;
}

describe('Outbox delivery (MySQL + Redis)', () => {
  let h: OutboxHarness;
  let connections: QueueConnectionOptions[];
  let queues: Queue<OutboxJobData>[];
  let workers: OutboxHandlerWorker[];
  let alerts: FakeAlertProvider;
  let registry: HandlerRegistry;

  const connection = (): QueueConnectionOptions => {
    const c = newQueueConnection();
    connections.push(c);
    return c;
  };
  const queue = (): Queue<OutboxJobData> => {
    const q = newOutboxQueue(connection());
    queues.push(q);
    return q;
  };
  const startWorker = async (): Promise<OutboxHandlerWorker> => {
    const w = await h.worker(registry, alerts, connection());
    workers.push(w);
    return w;
  };

  beforeAll(async () => {
    h = await OutboxHarness.create();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    connections = [];
    queues = [];
    workers = [];
    alerts = new FakeAlertProvider();
    registry = new HandlerRegistry();
    await h.truncate();
    await clearTestKeys(process.env.REDIS_URL as string);
  });

  afterEach(async () => {
    for (const w of workers) await w.onModuleDestroy();
    for (const q of queues) await q.close();
    for (const c of connections) await closeConnection(c);
  });

  it('an event published in a transaction that rolls back is never delivered', async () => {
    const handler = new RecordingHandler('test.rollback', 'user.registered');
    registry.register(handler);
    await startWorker();
    const relay = h.relay(queue(), registry, alerts, testOutboxConfig());
    const aggregateId = randomUUID();

    await expect(
      h.sequelize.transaction(async (transaction) => {
        await h.outbox.publish('user.registered', aggregateId, { userId: aggregateId }, transaction);
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow('business rule failed');

    expect(await relay.runOnce()).toEqual({ batches: 0, relayed: 0, retried: 0, failed: 0 });
    await sleep(300);
    expect(await h.rows()).toEqual([]);
    expect(handler.total).toBe(0);
    expect(await queues[0].getJobCounts()).toMatchObject({ waiting: 0, active: 0, completed: 0, failed: 0 });
  });

  it('publish without a transaction throws and writes nothing', async () => {
    const id = randomUUID();
    await expect(
      h.outbox.publish('user.registered', id, { userId: id }, undefined as never),
    ).rejects.toBeInstanceOf(OutboxPublishError);
    // A committed transaction is not a transaction to write into either.
    const finished = await h.sequelize.transaction(async (t) => t);
    await expect(h.outbox.publish('user.registered', id, { userId: id }, finished)).rejects.toThrow(/already finished/);
    expect(await h.rows()).toEqual([]);
  });

  it('happy path: every registered handler runs exactly once with the payload', async () => {
    const push = new RecordingHandler('test.push', 'match.created');
    const realtime = new RecordingHandler('test.realtime', 'match.created');
    const other = new RecordingHandler('test.other', 'match.ended');
    registry.register(push);
    registry.register(realtime);
    registry.register(other);
    await startWorker();
    const relay = h.relay(queue(), registry, alerts, testOutboxConfig());

    const matchId = randomUUID();
    const userIds: [string, string] = [randomUUID(), randomUUID()];
    const outboxId = await h.sequelize.transaction((t) =>
      h.outbox.publish('match.created', matchId, { matchId, userIds }, t),
    );

    expect(await relay.runOnce()).toMatchObject({ batches: 1, relayed: 1 });
    await waitUntil(() => push.total === 1 && realtime.total === 1, 10_000, 'both handlers');
    await sleep(300);
    expect(push.runs).toEqual(new Map([[outboxId, 1]]));
    expect(realtime.runs).toEqual(new Map([[outboxId, 1]]));
    expect(other.total).toBe(0);
    expect(push.payloads).toEqual([{ matchId, userIds }]);
    expect(push.attempts[0].attempt).toBe(1);
    const [row] = await h.rows();
    expect(row).toMatchObject({ id: outboxId, status: 'done', attempts: 0, last_error: null });
    // One job per handler, with the documented jobId.
    const q = queues[0];
    expect(await q.getJob(`${outboxId}-test.push`)).toBeDefined();
    expect(await q.getJob(`${outboxId}-test.realtime`)).toBeDefined();
    // A second tick finds nothing to do.
    expect(await relay.runOnce()).toMatchObject({ batches: 0 });
  });

  it('an event type with no handler is marked done without enqueueing anything', async () => {
    const relay = h.relay(queue(), registry, alerts, testOutboxConfig());
    const enqueued = spyOnEnqueue(queues[0]);
    const [id] = await h.publishMany(1, randomUUID());
    expect(await relay.runOnce()).toMatchObject({ relayed: 1 });
    expect(enqueued).toEqual([]);
    expect(await h.rows()).toEqual([expect.objectContaining({ id, status: 'done', attempts: 0 })]);
  });

  it('a tick drains full batches until one comes back short', async () => {
    const handler = new RecordingHandler('test.drain', 'user.registered');
    registry.register(handler);
    const relay = h.relay(queue(), registry, alerts, testOutboxConfig({ batchSize: 10 }));
    await h.publishMany(25, randomUUID());
    expect(await relay.runOnce()).toEqual({ batches: 3, relayed: 25, retried: 0, failed: 0 });
  });

  it('a tick stops when its time budget runs out, leaving the rest for the next tick', async () => {
    registry.register(new RecordingHandler('test.budget', 'user.registered'));
    const relay = h.relay(queue(), registry, alerts, testOutboxConfig({ batchSize: 5, relayTimeBudgetMs: 1 }));
    await h.publishMany(20, randomUUID());
    const first = await relay.runOnce();
    expect(first.batches).toBeLessThan(4);
    expect((await h.rows()).filter((r) => r.status === 'pending').length).toBe(20 - first.relayed);
  });

  it('a failing handler is retried with exponential backoff, then failed with one alert; others are unaffected', async () => {
    const failing = new RecordingHandler('test.always_fails', 'block.created', async () => {
      throw new TypeError('boom with user@example.com in the message');
    });
    const ok = new RecordingHandler('test.ok', 'block.created');
    registry.register(failing);
    registry.register(ok);
    await startWorker();
    const cfg = testOutboxConfig({ maxAttempts: 8, backoffBaseMs: 10 });
    const relay = h.relay(queue(), registry, alerts, cfg);

    const blockerId = randomUUID();
    const blockedId = randomUUID();
    const outboxId = await h.sequelize.transaction((t) =>
      h.outbox.publish('block.created', blockerId, { blockerId, blockedId }, t),
    );
    await relay.runOnce();

    await waitUntil(() => alerts.sent.length === 1, 20_000, 'the alert');
    expect(failing.attempts.map((a) => a.attempt)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // BullMQ exponential backoff: retry n waits base × 2^(n-1).
    const at = failing.attempts.map((a) => a.at);
    for (let n = 1; n < at.length; n++) {
      expect(at[n] - at[n - 1]).toBeGreaterThanOrEqual(10 * 2 ** (n - 1) - 5);
    }
    expect(alerts.sent).toEqual([
      {
        kind: 'outbox_handler_failed',
        eventType: 'block.created',
        outboxId,
        handler: 'test.always_fails',
        errorClass: 'TypeError',
      },
    ]);
    const job = await queues[0].getJob(`${outboxId}-test.always_fails`);
    expect(await job?.getState()).toBe('failed');
    expect(job?.attemptsMade).toBe(8);
    // Redis keeps only the error class: no message (it had an email in it) and no stack.
    expect(job?.failedReason).toBe('TypeError');
    expect(job?.stacktrace ?? []).toEqual([]);
    expect(JSON.stringify(job)).not.toContain('user@example.com');
    expect(ok.runs).toEqual(new Map([[outboxId, 1]]));
    // Handler failures never touch the outbox row: its attempts count relay failures only.
    expect(await h.rows()).toEqual([expect.objectContaining({ status: 'done', attempts: 0, last_error: null })]);
    await sleep(200);
    expect(failing.attempts).toHaveLength(8);
    expect(alerts.sent).toHaveLength(1);
  });

  it('two relays running at the same time on 500 events: every (event, handler) pair runs exactly once', async () => {
    const a = new RecordingHandler('test.pair_a', 'user.registered');
    const b = new RecordingHandler('test.pair_b', 'user.registered');
    registry.register(a);
    registry.register(b);
    await startWorker();
    await startWorker();
    const cfg = testOutboxConfig({ batchSize: 25 });
    const relayA = h.relay(queue(), registry, alerts, cfg);
    const relayB = h.relay(queue(), registry, alerts, cfg);
    const byA = spyOnEnqueue(queues[0]);
    const byB = spyOnEnqueue(queues[1]);

    const ids = await h.publishMany(500, randomUUID());
    const drain = async (relay: OutboxRelayService): Promise<void> => {
      while ((await relay.runOnce()).batches > 0) {
        /* keep going */
      }
    };
    await Promise.all([drain(relayA), drain(relayB)]);

    // SKIP LOCKED: the two relays never enqueued the same event.
    const all = [...byA, ...byB];
    expect(byA.length).toBeGreaterThan(0);
    expect(byB.length).toBeGreaterThan(0);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(1000);

    await waitUntil(() => a.total === 500 && b.total === 500, 30_000, '1000 handler runs');
    await sleep(500);
    for (const handler of [a, b]) {
      expect(handler.total).toBe(500);
      expect([...handler.runs.keys()].sort()).toEqual([...ids].sort());
      expect([...handler.runs.values()].every((n) => n === 1)).toBe(true);
    }
    expect((await h.rows()).every((r) => r.status === 'done' && r.attempts === 0)).toBe(true);
  });

  it('a crash after enqueue but before marking done re-enqueues the event, and each handler still runs once', async () => {
    class CrashingRelay extends OutboxRelayService {
      protected override async afterEnqueue(): Promise<void> {
        throw new Error('process killed');
      }
    }
    const a = new RecordingHandler('test.crash_a', 'user.registered');
    const b = new RecordingHandler('test.crash_b', 'user.registered');
    registry.register(a);
    registry.register(b);
    await startWorker();
    const cfg = testOutboxConfig();
    const crashingQueue = queue();
    const crashing = new CrashingRelay(h.sequelize, crashingQueue, registry, alerts, cfg);
    const healthyQueue = queue();
    const healthy = h.relay(healthyQueue, registry, alerts, cfg);
    const firstTry = spyOnEnqueue(crashingQueue);
    const secondTry = spyOnEnqueue(healthyQueue);

    const ids = await h.publishMany(3, randomUUID());
    await expect(crashing.runOnce()).rejects.toThrow('process killed');
    // The transaction rolled back: the rows are pending again, and a crash is not a relay failure.
    expect((await h.rows()).map((r) => [r.status, r.attempts])).toEqual([
      ['pending', 0],
      ['pending', 0],
      ['pending', 0],
    ]);
    await waitUntil(() => a.total === 3 && b.total === 3, 10_000, 'jobs from the first enqueue');

    expect(await healthy.runOnce()).toMatchObject({ relayed: 3 });
    expect(secondTry).toEqual(firstTry);
    expect(firstTry).toHaveLength(6);
    await sleep(500);
    for (const handler of [a, b]) {
      expect(handler.runs).toEqual(new Map(ids.map((id) => [id, 1])));
    }
    expect((await h.rows()).every((r) => r.status === 'done')).toBe(true);
  });
});
