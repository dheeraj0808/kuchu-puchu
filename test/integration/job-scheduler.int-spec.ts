import { randomUUID } from 'node:crypto';

import { Queue } from 'bullmq';

import { OutboxCleanupJob } from '../../src/events/outbox-jobs';
import type { QueueConnectionOptions } from '../../src/infra/queue/queue-connection.module';
import { JobSchedulerService, SCHEDULED_JOBS_QUEUE_NAME } from '../../src/jobs/job-scheduler.service';
import { type JobRunContext, type PeriodicJob, PeriodicJobRegistry } from '../../src/jobs/periodic-job';
import { OutboxHarness, closeConnection, newQueueConnection, sleep, testOutboxConfig } from '../support/outbox-harness';
import { clearTestKeys } from '../support/test-redis';

describe('Job scheduler (BullMQ job schedulers)', () => {
  const started: Array<{ scheduler: JobSchedulerService; connection: QueueConnectionOptions }> = [];

  async function startScheduler(jobs: PeriodicJob[]): Promise<JobSchedulerService> {
    const registry = new PeriodicJobRegistry();
    for (const job of jobs) registry.register(job);
    const connection = newQueueConnection();
    const scheduler = new JobSchedulerService(registry, connection, { failedJobRetentionSeconds: 3600 });
    await scheduler.start();
    started.push({ scheduler, connection });
    return scheduler;
  }

  async function stopAll(): Promise<void> {
    for (const { scheduler, connection } of started.splice(0)) {
      await scheduler.onModuleDestroy();
      await closeConnection(connection);
    }
  }

  beforeEach(async () => {
    await clearTestKeys(process.env.REDIS_URL as string);
  });

  afterEach(stopAll);

  it('a repeatable job runs once per tick with two worker instances', async () => {
    const ticks: Array<JobRunContext & { instance: string }> = [];
    const tickJob = (instance: string): PeriodicJob => ({
      name: 'test.tick',
      schedule: { every: 200 },
      run: async (ctx) => {
        ticks.push({ ...ctx, instance });
        await sleep(20);
      },
    });
    await startScheduler([tickJob('A')]);
    await startScheduler([tickJob('B')]);
    await sleep(2_100);
    await stopAll();

    const ids = ticks.map((t) => t.jobId);
    expect(new Set(ids).size).toBe(ids.length);
    // Scheduler job ids end in the tick's slot time: one run per slot.
    const slots = ids.map((id) => Number(/:(\d+)$/.exec(id)?.[1]));
    expect(slots.every((s) => s > 0 && s % 200 === slots[0] % 200)).toBe(true);
    expect(new Set(slots).size).toBe(slots.length);
    // ~10 ticks in 2.1 s at 200 ms, each run by exactly one of the two instances.
    expect(ticks.length).toBeGreaterThanOrEqual(8);
    expect(ticks.length).toBeLessThanOrEqual(12);
  });

  it('removes the scheduler of a job that is no longer registered', async () => {
    const noop = (name: string): PeriodicJob => ({ name, schedule: { pattern: '0 3 * * *' }, run: async () => undefined });
    await startScheduler([noop('test.old'), noop('test.kept')]);
    await stopAll();
    await startScheduler([noop('test.kept')]);

    const connection = newQueueConnection();
    const queue = new Queue(SCHEDULED_JOBS_QUEUE_NAME, { ...connection });
    try {
      const schedulers = await queue.getJobSchedulers();
      expect(schedulers.map((s) => s.key)).toEqual(['test.kept']);
      expect(schedulers[0]).toMatchObject({ pattern: '0 3 * * *', tz: 'UTC' });
    } finally {
      await queue.close();
      await closeConnection(connection);
    }
  });
});

describe('Outbox cleanup job', () => {
  let h: OutboxHarness;

  beforeAll(async () => {
    h = await OutboxHarness.create();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(() => h.truncate());

  async function insert(status: string, createdDaysAgo: number, availableDaysAgo = createdDaysAgo): Promise<string> {
    const id = randomUUID();
    await h.sequelize.query(
      `INSERT INTO outbox_events (event_type, aggregate_id, payload, status, attempts, available_at, created_at)
       VALUES ('user.registered', :id, JSON_OBJECT('userId', :id), :status, 0,
               NOW(3) - INTERVAL :available HOUR, NOW(3) - INTERVAL :created HOUR)`,
      { replacements: { id, status, created: createdDaysAgo * 24, available: availableDaysAgo * 24 } },
    );
    return id;
  }

  const aggregates = async (): Promise<string[]> =>
    (
      await h.sequelize.query<{ aggregate_id: string }>('SELECT aggregate_id FROM outbox_events', {
        type: 'SELECT' as never,
      })
    )
      .map((r) => r.aggregate_id)
      .sort();

  it('deletes only done events older than 7 days', async () => {
    const oldDone = await insert('done', 8);
    const kept = [
      await insert('done', 6),
      await insert('done', 6.9),
      await insert('pending', 8),
      await insert('failed', 30),
    ];
    const job = new OutboxCleanupJob(h.sequelize, testOutboxConfig());
    expect(job.schedule).toEqual({ pattern: '30 21 * * *' });

    expect(await job.deleteExpired()).toEqual({ deleted: 1, batches: 1 });
    const left = await aggregates();
    expect(left).toEqual([...kept].sort());
    expect(left).not.toContain(oldDone);
  });

  it('deletes in batches until one is short', async () => {
    for (let i = 0; i < 5; i++) await insert('done', 10);
    const recent = await insert('done', 1);
    const job = new OutboxCleanupJob(h.sequelize, testOutboxConfig({ cleanupBatchSize: 2 }));
    expect(await job.deleteExpired()).toEqual({ deleted: 5, batches: 3 });
    expect(await aggregates()).toEqual([recent]);
  });
});
