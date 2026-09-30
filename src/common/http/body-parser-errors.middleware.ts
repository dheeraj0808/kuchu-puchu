import type { NextFunction, Request, Response } from 'express';

import { AppException, ErrorCode } from '../exceptions/app.exception';

interface BodyParserError {
  type?: unknown;
  status?: unknown;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return typeof err === 'object' && err !== null && typeof (err as BodyParserError).type === 'string';
}

/**
 * Translates body-parser errors into AppExceptions. Without this, Nest maps
 * malformed JSON to a generic 400 and an oversized body to a 500, because
 * body-parser's errors are not HttpExceptions.
 * Registered directly after the body parsers; everything else passes through.
 */
export function bodyParserErrorsMiddleware(
  err: unknown,
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!isBodyParserError(err)) return next(err);
  switch (err.type) {
    case 'entity.parse.failed':
      return next(new AppException(ErrorCode.ValidationError, { errors: ['Request body is not valid JSON'] }));
    case 'entity.too.large':
    case 'parameters.too.many':
      return next(new AppException(ErrorCode.PayloadTooLarge));
    default: {
      const status = typeof err.status === 'number' ? err.status : 500;
      return next(status < 500 ? new AppException(ErrorCode.InvalidRequest) : err);
    }
  }
}
