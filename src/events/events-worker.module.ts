import { Global, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import type { RedisConfig } from '../config/integrations.config';
import { errorClassOf } from '../infra/alerts/alert.provider';
import { QUEUE_CONNECTION, type QueueConnectionOptions } from '../infra/queue/queue-connection.module';
import { createRedisClient } from '../infra/redis/redis.module';
import { PeriodicJobRegistry } from '../jobs/periodic-job';
import { EventsModule } from './events.module';
import { HandlerRegistry } from './handler-registry';
import { OutboxHandlerWorker } from './outbox-handler.worker';
import { OutboxCleanupJob, OutboxRelayJob } from './outbox-jobs';
import { OutboxRelayService } from './outbox-relay.service';
import { OUTBOX_QUEUE, OUTBOX_QUEUE_NAME } from './outbox.constants';

/**
 * Delivery side of the outbox, imported by the worker process only: the
 * relay, the handler worker, the cleanup job and the HandlerRegistry that
 * other worker-side modules register their handlers with.
 */
@Global()
@Module({
  imports: [EventsModule],
  providers: [
    HandlerRegistry,
    {
      provide: OUTBOX_QUEUE,
      inject: [QUEUE_CONNECTION, ConfigService],
      useFactory: (shared: QueueConnectionOptions, config: ConfigService): Queue => {
        const logger = new Logger('OutboxQueue');
        // Own producer connection without an offline queue: while Redis is down an add
        // fails at once instead of being parked in memory and sent later.
        const connection = createRedisClient(config.getOrThrow<RedisConfig>('redis'), {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectionName: 'kuchu-puchu-outbox-producer',
        });
        const queue = new Queue(OUTBOX_QUEUE_NAME, { connection, prefix: shared.prefix });
        queue.on('error', (err) => logger.error({ err: errorClassOf(err) }, 'Outbox queue error'));
        return queue;
      },
    },
    OutboxRelayService,
    OutboxHandlerWorker,
    OutboxRelayJob,
    OutboxCleanupJob,
  ],
  exports: [HandlerRegistry],
})
export class EventsWorkerModule implements OnModuleInit {
  constructor(
    private readonly jobs: PeriodicJobRegistry,
    private readonly relayJob: OutboxRelayJob,
    private readonly cleanupJob: OutboxCleanupJob,
  ) {}

  onModuleInit(): void {
    this.jobs.register(this.relayJob);
    this.jobs.register(this.cleanupJob);
  }
}
