import { HttpException, HttpStatus } from '@nestjs/common';

export enum ErrorCode {
  InvalidRequest = 'INVALID_REQUEST',
  ValidationError = 'VALIDATION_ERROR',
  Unauthorized = 'UNAUTHORIZED',
  Forbidden = 'FORBIDDEN',
  NotFound = 'NOT_FOUND',
  TooManyRequests = 'TOO_MANY_REQUESTS',
  OtpInvalid = 'OTP_INVALID',
  OtpCooldown = 'OTP_COOLDOWN',
  OtpDeliveryFailed = 'OTP_DELIVERY_FAILED',
  InvalidRefreshToken = 'INVALID_REFRESH_TOKEN',
  AccountRestricted = 'ACCOUNT_RESTRICTED',
  ProfileNotFound = 'PROFILE_NOT_FOUND',
  ProfileAlreadyExists = 'PROFILE_ALREADY_EXISTS',
  ProfileDobLocked = 'PROFILE_DOB_LOCKED',
  InvalidInterests = 'INVALID_INTERESTS',
  PreferencesAlreadyExist = 'PREFERENCES_ALREADY_EXIST',
  PreferencesNotFound = 'PREFERENCES_NOT_FOUND',
  InternalError = 'INTERNAL_ERROR',
}

/**
 * Application exception carrying a stable, client-safe error code.
 * `message` must be safe to show to clients.
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
    public readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}
