import type { IncomingMessage } from 'node:http';

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

import type { AppConfig } from '../../config/app.config';
import { API_PREFIX } from '../constants';
import { resolveRequestId } from '../http/request-id.middleware';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'req.body',
  '*.otp',
  '*.code',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.identifier',
  '*.email',
  '*.phone',
];

interface SerializedReq {
  id?: unknown;
  method?: string;
  url?: string;
  remoteAddress?: string;
}

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const app = config.getOrThrow<AppConfig>('app');
        const pretty = app.nodeEnv === 'development';
        return {
          pinoHttp: {
            level: app.logLevel,
            transport: pretty
              ? {
                  target: 'pino-pretty',
                  options: { singleLine: true, colorize: true },
                }
              : undefined,
            redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
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
          },
        };
      },
    }),
  ],
})
export class LoggerModule {}
