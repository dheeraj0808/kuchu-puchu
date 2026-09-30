import { Logger as NestLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { setupSwagger } from './common/swagger';
import type { AppConfig } from './config/app.config';

const DEV_ORIGIN_PATTERNS = [
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

function parseTrustProxy(raw: string | undefined): boolean | number | string {
  if (raw === undefined || raw === '') return false;
  const value = raw.trim();
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  return value;
}

function isOriginAllowed(origin: string, app: AppConfig): boolean {
  if (app.corsOrigins.length > 0) return app.corsOrigins.includes(origin);
  if (app.isProduction) return false;
  return DEV_ORIGIN_PATTERNS.some((re) => re.test(origin));
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  const appConfig = app.get(ConfigService).getOrThrow<AppConfig>('app');

  app.set('trust proxy', parseTrustProxy(appConfig.trustProxy));
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(compression());
  app.useBodyParser('json', { limit: '100kb' });

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ): void => {
      // Non-browser clients (mobile app, curl) send no Origin header.
      if (!origin) return callback(null, true);
      callback(null, isOriginAllowed(origin, appConfig));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'X-Device-Id',
    ],
    maxAge: 600,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(
    new AllExceptionsFilter(new NestLogger(AllExceptionsFilter.name)),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.enableShutdownHooks();

  if (appConfig.swaggerEnabled) {
    setupSwagger(app);
  }

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
