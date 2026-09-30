import { writeSync } from 'node:fs';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  const appConfig = await configureApp(app);
  await app.listen(appConfig.port);
}

bootstrap().catch((err: unknown) => {
  // Written synchronously: the app logger is async and process.exit() would
  // drop the message, leaving no clue why the server refused to start.
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  writeSync(process.stderr.fd, `Application failed to start: ${detail}\n`);
  process.exit(1);
});
