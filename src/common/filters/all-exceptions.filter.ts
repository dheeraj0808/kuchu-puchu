import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AppException, ErrorCode } from '../exceptions/app.exception';

interface ErrorBody {
  success: false;
  message: string;
  code: string;
  timestamp: string;
  path: string;
  requestId?: string;
  details?: Record<string, unknown>;
}

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.InvalidRequest,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.Unauthorized,
  [HttpStatus.FORBIDDEN]: ErrorCode.Forbidden,
  [HttpStatus.NOT_FOUND]: ErrorCode.NotFound,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TooManyRequests,
};

const DEFAULT_MESSAGES: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Invalid request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not found',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too many requests',
};

type RequestWithId = Request & { id?: unknown };

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: Logger = new Logger(AllExceptionsFilter.name),
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<RequestWithId>();
    const res = ctx.getResponse<Response>();

    const { status, code, message, details } = this.resolve(exception);

    const body: ErrorBody = {
      success: false,
      message,
      code,
      timestamp: new Date().toISOString(),
      path: (req.originalUrl ?? req.url ?? '').split('?')[0],
    };
    const requestId =
      typeof req.id === 'string' || typeof req.id === 'number'
        ? String(req.id)
        : undefined;
    if (requestId) body.requestId = requestId;
    if (details) body.details = details;

    if (!res.headersSent) {
      res.status(status).json(body);
    }
  }

  private resolve(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
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
        const errors = ((response as { message: unknown[] }).message).filter(
          (m): m is string => typeof m === 'string',
        );
        return {
          status,
          code: ErrorCode.ValidationError,
          message: 'Validation failed',
          details: { errors },
        };
      }

      if (status >= 500) {
        this.logInternal(exception);
        return this.internal();
      }

      return {
        status,
        code: STATUS_CODES[status] ?? ErrorCode.InvalidRequest,
        message: this.httpMessage(response, status),
      };
    }

    this.logInternal(exception);
    return this.internal();
  }

  private httpMessage(response: string | object, status: number): string {
    if (typeof response === 'string') return response;
    const msg = (response as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
    return DEFAULT_MESSAGES[status] ?? 'Request failed';
  }

  private internal(): {
    status: number;
    code: string;
    message: string;
  } {
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.InternalError,
      message: 'Internal server error',
    };
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
