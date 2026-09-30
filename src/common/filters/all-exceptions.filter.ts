import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AppException, ERROR_DEFINITIONS, ErrorCode } from '../exceptions/app.exception';

/** Error body from guide §4.1. */
export interface ErrorBody {
  success: false;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
}

/** Codes used for framework exceptions that were not raised as AppException. */
const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.InvalidRequest,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.Unauthorized,
  [HttpStatus.FORBIDDEN]: ErrorCode.Forbidden,
  [HttpStatus.NOT_FOUND]: ErrorCode.NotFound,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TooManyRequests,
};

/** Used when a 429 carries no Retry-After information at all. */
const DEFAULT_RETRY_AFTER_SECONDS = 60;

type RequestWithId = Request & { id?: unknown };

interface Resolved {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: Logger = new Logger(AllExceptionsFilter.name),
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<RequestWithId>();
    const res = ctx.getResponse<Response>();

    const resolved = this.resolve(exception);
    if (resolved.status === HttpStatus.TOO_MANY_REQUESTS) {
      resolved.details = withRetryAfter(resolved.details, res);
    }

    const body: ErrorBody = {
      success: false,
      code: resolved.code,
      message: resolved.message,
    };
    if (resolved.details) body.details = resolved.details;
    const requestId =
      typeof req.id === 'string' || typeof req.id === 'number'
        ? String(req.id)
        : undefined;
    if (requestId) body.requestId = requestId;

    if (!res.headersSent) {
      res.status(resolved.status).json(body);
    }
  }

  private resolve(exception: unknown): Resolved {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      if (
        status === HttpStatus.BAD_REQUEST &&
        typeof response === 'object' &&
        response !== null &&
        Array.isArray((response as { message?: unknown }).message)
      ) {
        // class-validator messages describe the rule broken, never the value sent.
        const errors = ((response as { message: unknown[] }).message).filter(
          (m): m is string => typeof m === 'string',
        );
        return {
          status,
          code: ErrorCode.ValidationError,
          message: ERROR_DEFINITIONS[ErrorCode.ValidationError].defaultMessage,
          details: { errors },
        };
      }

      if (status >= 500) {
        this.logInternal(exception);
        return this.internal();
      }

      // Library messages (e.g. "Cannot GET /x") are never sent to clients.
      const code = STATUS_CODES[status] ?? ErrorCode.InvalidRequest;
      return { status, code, message: ERROR_DEFINITIONS[code].defaultMessage };
    }

    this.logInternal(exception);
    return this.internal();
  }

  private internal(): Resolved {
    const { httpStatus, defaultMessage } = ERROR_DEFINITIONS[ErrorCode.InternalError];
    return { status: httpStatus, code: ErrorCode.InternalError, message: defaultMessage };
  }

  private logInternal(exception: unknown): void {
    // Server-side only: name + stack. Never returned to the client.
    if (exception instanceof Error) {
      this.logger.error(`Unhandled ${exception.name}`, exception.stack);
    } else {
      this.logger.error('Unhandled non-error exception');
    }
  }
}

/** Every 429 tells the client how long to wait (Appendix C). */
function withRetryAfter(
  details: Record<string, unknown> | undefined,
  res: Response,
): Record<string, unknown> {
  if (typeof details?.retryAfterSeconds === 'number') return details;
  const header = Number.parseInt(String(res.getHeader('Retry-After') ?? ''), 10);
  const retryAfterSeconds =
    Number.isInteger(header) && header > 0 ? header : DEFAULT_RETRY_AFTER_SECONDS;
  return { ...details, retryAfterSeconds };
}
