import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Redis } from 'ioredis';

import { HandlerRegistry } from '../../src/events/handler-registry';
import { OutboxHandlerWorker } from '../../src/events/outbox-handler.worker';
import { OutboxRelayService } from '../../src/events/outbox-relay.service';
import { REDIS_CLIENT } from '../../src/infra/redis/redis.module';
import { JobSchedulerService } from '../../src/jobs/job-scheduler.service';
import { createTestApp } from '../support/test-app';
import { clearTestKeys } from '../support/test-redis';

describe('API process and the outbox', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    await clearTestKeys(process.env.REDIS_URL as string);
    app = await createTestApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ['OutboxRelayService', OutboxRelayService],
    ['OutboxHandlerWorker', OutboxHandlerWorker],
    ['JobSchedulerService', JobSchedulerService],
    ['HandlerRegistry', HandlerRegistry],
  ])('has no %s (relay, handlers and scheduler run in the worker only)', (_name, token) => {
    expect(() => app.get(token, { strict: false })).toThrow();
  });

  it('creates no BullMQ queues or schedulers in Redis', async () => {
    const keys = await app.get<Redis>(REDIS_CLIENT).keys('kp:queue:*');
    expect(keys).toEqual([]);
  });
});
