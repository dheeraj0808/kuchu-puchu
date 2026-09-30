import { ValidationPipe } from '@nestjs/common';

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    stopAtFirstError: false,
    // Field messages are kept in production; values are never echoed.
    disableErrorMessages: false,
    validationError: { target: false, value: false },
  });
}
