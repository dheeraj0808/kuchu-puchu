import type { IncomingMessage } from 'node:http';

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { Options as PinoHttpOptions } from 'pino-http';

import type { AppConfig } from '../../config/app.config';
import { API_PREFIX } from '../constants';
import { resolveRequestId } from '../http/request-id.middleware';
import { REDACTED, redactDeep } from './redact';

/**
 * Exact paths for things that must go whole (raw headers, request bodies).
 * Everything else (otp, token, email, phone, …) is redacted at any depth by
 * redactDeep in formatters.log.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'req.body',
];

interface SerializedReq {
  id?: unknown;
  method?: string;
  url?: string;
  remoteAddress?: string;
}

/** pino-http options for the app; exported so tests log through the exact same settings. */
export function buildPinoHttpOptions(app: AppConfig): PinoHttpOptions {
  const pretty = app.nodeEnv === 'development';
  return {
    level: app.logLevel,
    transport: pretty
      ? {
          target: 'pino-pretty',
          options: { singleLine: true, colorize: true },
        }
      : undefined,
    redact: { paths: REDACT_PATHS, censor: REDACTED },
    formatters: {
      log: (object: Record<string, unknown>): Record<string, unknown> => redactDeep(object),
    },
    // requestIdMiddleware (app.setup.ts) has usually set req.id already.
    genReqId: (req: IncomingMessage): string => resolveRequestId(req),
    serializers: {
      req: (req: SerializedReq): SerializedReq => ({
        id: req.id,
        method: req.method,
        url: req.url?.split('?')[0],
        remoteAddress: req.remoteAddress,
      }),
    },
    autoLogging: {
      ignore: (req: IncomingMessage): boolean =>
        (req.url ?? '').split('?')[0] === `/${API_PREFIX}/health`,
    },
  };
}

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: buildPinoHttpOptions(config.getOrThrow<AppConfig>('app')),
      }),
    }),
  ],
})
export class LoggerModule {}
