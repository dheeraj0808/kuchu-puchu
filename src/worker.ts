import { type INestApplicationContext, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AccountWorkerModule } from './account/account-worker.module';
import { AccountRegistryModule } from './account/registry/account-registry';
import { AuthWorkerModule } from './auth/auth-cleanup.jobs';
import { runRole } from './bootstrap/run-role';
import { AppRole } from './config/env.validation';
import { CoreModule } from './core.module';
import { EventsWorkerModule } from './events/events-worker.module';
import { AlertsModule } from './infra/alerts/alerts.module';
import { EmailModule } from './infra/email/email.module';
import { StorageModule } from './infra/storage/storage.module';
import { QueueConnectionModule } from './infra/queue/queue-connection.module';
import { JobsModule } from './jobs/jobs.module';
import { SecurityWorkerModule } from './security/security-retention.job';
import { SecurityModule } from './security/security.module';
import { SettingsModule } from './settings/settings.module';
import { UsersWorkerModule } from './users/revoke-sessions.handler';

/**
 * Worker process (guide §3.1): background jobs, no HTTP server. Runs the
 * outbox relay and handlers and every periodic job. The BullMQ workers keep
 * the process alive; on SIGTERM they stop taking jobs and let in-flight ones
 * finish before the connections close.
 */
@Module({
  imports: [
    CoreModule,
    QueueConnectionModule,
    AlertsModule,
    EmailModule,
    StorageModule,
    AccountRegistryModule,
    SettingsModule,
    JobsModule,
    EventsWorkerModule,
    SecurityModule,
    SecurityWorkerModule,
    UsersWorkerModule,
    AuthWorkerModule,
    AccountWorkerModule,
  ],
})
export class WorkerModule {}

export async function startWorker(): Promise<INestApplicationContext> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  await app.init();
  return app;
}

if (require.main === module) void runRole(AppRole.Worker, startWorker);
