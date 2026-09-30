import {
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { QueueOptions } from 'bullmq';
import type { Redis } from 'ioredis';

import type { RedisConfig } from '../../config/integrations.config';
import { createRedisClient } from '../redis/redis.module';
import { REDIS_KEY_PREFIX } from '../redis/redis-keys';

/** Injection token for the options every BullMQ Queue/Worker is created with. */
export const QUEUE_CONNECTION = Symbol('QUEUE_CONNECTION');

/** BullMQ keys live under kp:queue:<queueName>:… */
export const QUEUE_PREFIX = `${REDIS_KEY_PREFIX}:queue`;

/** Spread into every `new Queue(name, …)` / `new Worker(name, …)` (M03). */
export type QueueConnectionOptions = Required<Pick<QueueOptions, 'prefix'>> & { connection: Redis };

@Injectable()
class QueueConnectionShutdown implements OnApplicationShutdown {
  constructor(@Inject(QUEUE_CONNECTION) private readonly options: QueueConnectionOptions) {}

  async onApplicationShutdown(): Promise<void> {
    const { connection } = this.options;
    if (connection.status === 'wait') return connection.disconnect();
    if (connection.status !== 'end') {
      await connection.quit().catch(() => connection.disconnect());
    }
  }
}

/**
 * The Redis connection BullMQ queues and workers share. No queues exist yet;
 * they arrive with M03. The connection is lazy, so nothing connects until the
 * first queue uses it.
 */
@Global()
@Module({
  providers: [
    {
      provide: QUEUE_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService): QueueConnectionOptions => ({
        // BullMQ workers need maxRetriesPerRequest: null for blocking commands.
        connection: createRedisClient(config.getOrThrow<RedisConfig>('redis'), {
          maxRetriesPerRequest: null,
          lazyConnect: true,
          connectionName: 'kuchu-puchu-queue',
        }),
        prefix: QUEUE_PREFIX,
      }),
    },
    QueueConnectionShutdown,
  ],
  exports: [QUEUE_CONNECTION],
})
export class QueueConnectionModule {}
