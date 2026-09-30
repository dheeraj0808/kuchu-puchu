import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis, type RedisOptions } from 'ioredis';

import type { RedisConfig } from '../../config/integrations.config';

/** Injection token for the shared ioredis client. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export function redisOptions(config: RedisConfig): RedisOptions {
  return {
    // rediss:// already implies TLS; REDIS_TLS forces it for plain redis:// URLs.
    ...(config.tls ? { tls: {} } : {}),
    connectionName: 'kuchu-puchu',
  };
}

export function createRedisClient(config: RedisConfig, extra: RedisOptions = {}): Redis {
  const logger = new Logger('Redis');
  const client = new Redis(config.url, { ...redisOptions(config), ...extra });
  // Log the error type only: messages can include the connection URL.
  client.on('error', (err: Error) => logger.error(`Redis connection error: ${err.name}`));
  return client;
}

@Injectable()
class RedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status !== 'end') {
      await this.redis.quit().catch(() => this.redis.disconnect());
    }
  }
}

/** One shared ioredis client for caches, counters and rate limits. */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis =>
        createRedisClient(config.getOrThrow<RedisConfig>('redis')),
    },
    RedisShutdown,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
