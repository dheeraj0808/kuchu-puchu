import { HttpException } from '@nestjs/common';

import { ERROR_DEFINITIONS, ErrorCode } from './error-codes';

export { ERROR_DEFINITIONS, ErrorCode } from './error-codes';

/**
 * Application exception carrying a stable, client-safe error code.
 * Status and message come from ERROR_DEFINITIONS, so the same code always
 * produces the same response.
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    const { httpStatus, defaultMessage } = ERROR_DEFINITIONS[code];
    super({ code, message: defaultMessage, details }, httpStatus);
  }
}
