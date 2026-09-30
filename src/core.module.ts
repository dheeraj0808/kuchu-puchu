import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { LoggerModule } from './common/logging/logger.module';
import { configLoaders, validateEnv } from './config';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './infra/redis/redis.module';

/**
 * What every process type needs (guide §3.1): validated config, JSON logs,
 * MySQL and Redis. AppModule (API), RealtimeModule and WorkerModule all start
 * from here. ConfigModule.forRoot() runs when this file is imported, so .env
 * is loaded and validated before any module reads getValidatedEnv().
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: configLoaders,
      validate: validateEnv,
      envFilePath: '.env',
    }),
    LoggerModule,
    DatabaseModule,
    RedisModule,
  ],
})
export class CoreModule {}
