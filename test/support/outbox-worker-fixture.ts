/**
 * The real worker process plus one slow test handler, for the SIGTERM test
 * in entrypoints.int-spec.ts. Markers go straight to stdout.
 */
import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { runRole } from '../../src/bootstrap/run-role';
import { AppRole } from '../../src/config/env.validation';
import { HandlerRegistry } from '../../src/events/handler-registry';
import { WorkerModule } from '../../src/worker';

const HANDLER_MS = Number(process.env.FIXTURE_HANDLER_MS ?? 1500);

@Injectable()
class SlowHandlerRegistrar implements OnModuleInit {
  constructor(private readonly registry: HandlerRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'test.slow',
      eventType: 'user.registered',
      handle: async (event) => {
        process.stdout.write(`[fixture] handler started ${event.outboxId}\n`);
        await new Promise((r) => setTimeout(r, HANDLER_MS));
        process.stdout.write(`[fixture] handler finished ${event.outboxId}\n`);
      },
    });
  }
}

@Module({ imports: [WorkerModule], providers: [SlowHandlerRegistrar] })
class FixtureWorkerModule {}

void runRole(AppRole.Worker, async () => {
  const app = await NestFactory.createApplicationContext(FixtureWorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  await app.init();
  return app;
});
