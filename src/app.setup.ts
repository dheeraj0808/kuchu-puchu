import { Logger as NestLogger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import type { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import helmet from 'helmet';

import { API_PREFIX } from './common/constants';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { bodyParserErrorsMiddleware } from './common/http/body-parser-errors.middleware';
import { requestIdMiddleware } from './common/http/request-id.middleware';
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

/**
 * HTTP pipeline shared by main.ts and the e2e tests, so tests exercise the
 * same prefix, validation, error and response shapes as production.
 * Initialises the app; callers only need to listen().
 */
export async function configureApp(app: NestExpressApplication): Promise<AppConfig> {
  const appConfig = app.get(ConfigService).getOrThrow<AppConfig>('app');
  const exceptionsFilter = new AllExceptionsFilter(new NestLogger(AllExceptionsFilter.name));

  app.set('trust proxy', parseTrustProxy(appConfig.trustProxy));
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(compression());
  app.useBodyParser('json', { limit: '100kb' });
  // Registered here (not by Nest at init) so both parsers sit in front of the error mapper.
  app.useBodyParser('urlencoded', { limit: '100kb', extended: true });
  app.use(bodyParserErrorsMiddleware);

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

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(exceptionsFilter);
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.enableShutdownHooks();

  if (appConfig.swaggerEnabled) {
    setupSwagger(app);
  }

  await app.init();

  // Nest mounts its 404 handler under the global prefix only, so any other path
  // (e.g. /api/health, /) would fall through to Express's HTML 404. Nest's
  // adapter offers a root-level handler that skips the prefixes it already
  // covers; it renders through the same filter so the body matches §4.1.
  (app.getHttpAdapter() as ExpressAdapter).setNotFoundHandler((req: unknown, res: unknown) => {
    exceptionsFilter.catch(new NotFoundException(), new ExecutionContextHost([req, res]));
  });
  return appConfig;
}
