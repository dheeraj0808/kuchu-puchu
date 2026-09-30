import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

import type { AppConfig } from '../../config/app.config';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

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
            genReqId: (req: IncomingMessage, res: ServerResponse): string => {
              const incoming = req.headers['x-request-id'];
              const id =
                typeof incoming === 'string' &&
                REQUEST_ID_PATTERN.test(incoming)
                  ? incoming
                  : randomUUID();
              res.setHeader('x-request-id', id);
              return id;
            },
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
                (req.url ?? '').split('?')[0] === '/api/health',
            },
          },
        };
      },
    }),
  ],
})
export class LoggerModule {}
