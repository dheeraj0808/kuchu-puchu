import { Logger as NestLogger } from '@nestjs/common';
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
  const logger = new NestLogger('Bootstrap');
  logger.error(
    'Application failed to start',
    err instanceof Error ? err.stack : undefined,
  );
  process.exit(1);
});
