import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { runRole } from './bootstrap/run-role';
import { AppRole, getValidatedEnv, resolveAppRole } from './config/env.validation';
import { startRealtime } from './realtime';
import { startWorker } from './worker';

/** API process: REST under /api/v1 (guide §3.1). */
export async function startApi(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const appConfig = await configureApp(app);
  await app.listen(appConfig.port);
  return app;
}

/**
 * One build, three process types, selected by APP_ROLE (api | realtime |
 * worker; default api). Importing AppModule above has already loaded and
 * validated .env, so APP_ROLE is known here.
 */
async function main(): Promise<void> {
  switch (resolveAppRole(getValidatedEnv())) {
    case AppRole.Realtime:
      return runRole(AppRole.Realtime, startRealtime);
    case AppRole.Worker:
      return runRole(AppRole.Worker, startWorker);
    default:
      return runRole(AppRole.Api, startApi);
  }
}

if (require.main === module) void main();
