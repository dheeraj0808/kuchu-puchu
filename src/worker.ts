import {
  type INestApplicationContext,
  Injectable,
  Logger as NestLogger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { runRole } from './bootstrap/run-role';
import { AppRole } from './config/env.validation';
import { CoreModule } from './core.module';
import { QueueConnectionModule } from './infra/queue/queue-connection.module';

/**
 * Keeps the worker process alive until shutdown. There is no queue consumer
 * yet (queues, the outbox relay and repeatable jobs arrive with M03), so
 * nothing else would hold the event loop open.
 */
@Injectable()
class WorkerLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new NestLogger('Worker');
  private keepAlive?: NodeJS.Timeout;

  onApplicationBootstrap(): void {
    this.keepAlive = setInterval(() => undefined, 60 * 60 * 1000);
    this.logger.log('No queues registered yet (M03)');
  }

  onApplicationShutdown(): void {
    if (this.keepAlive) clearInterval(this.keepAlive);
  }
}

/** Worker process (guide §3.1): background jobs, no HTTP server. */
@Module({ imports: [CoreModule, QueueConnectionModule], providers: [WorkerLifecycle] })
export class WorkerModule {}

export async function startWorker(): Promise<INestApplicationContext> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  await app.init();
  return app;
}

if (require.main === module) void runRole(AppRole.Worker, startWorker);
