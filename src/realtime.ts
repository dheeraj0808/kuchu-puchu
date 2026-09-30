import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { configureApp } from './app.setup';
import { runRole } from './bootstrap/run-role';
import { AppRole } from './config/env.validation';
import { CoreModule } from './core.module';
import { HealthModule } from './health/health.module';

/**
 * Realtime process (guide §3.1). Only the HTTP shell and /api/v1/health for
 * the load balancer so far; the Socket.IO gateway and Redis adapter arrive
 * with M19.
 */
@Module({ imports: [CoreModule, HealthModule] })
export class RealtimeModule {}

export async function startRealtime(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(RealtimeModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const appConfig = await configureApp(app, { swagger: false });
  await app.listen(appConfig.port);
  return app;
}

if (require.main === module) void runRole(AppRole.Realtime, startRealtime);
