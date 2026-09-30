import { BadRequestException, type ArgumentsHost, HttpException, Logger, NotFoundException } from '@nestjs/common';

import { AppException, ErrorCode } from '../exceptions/app.exception';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown, headers: Record<string, string> = {}) {
  const res = {
    headersSent: false,
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    getHeader: (name: string) => headers[name],
  };
  const req = { id: 'req-123', url: '/api/v1/x' };
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;
  const logger = { error: jest.fn() } as unknown as Logger;
  new AllExceptionsFilter(logger).catch(exception, host);
  return { status: res.statusCode, body: res.body as Record<string, unknown>, logger };
}

describe('AllExceptionsFilter', () => {
  it('renders an AppException as the §4.1 error body', () => {
    const { status, body } = run(new AppException(ErrorCode.ProfileNotFound));
    expect(status).toBe(404);
    expect(body).toEqual({
      success: false,
      code: 'PROFILE_NOT_FOUND',
      message: 'Profile not found',
      requestId: 'req-123',
    });
  });

  it('never leaks Nest library messages such as "Cannot GET /x"', () => {
    const { body } = run(new NotFoundException('Cannot GET /api/v1/x'));
    expect(body).toEqual({ success: false, code: 'NOT_FOUND', message: 'Not found', requestId: 'req-123' });
  });

  it('maps class-validator arrays to VALIDATION_ERROR with details.errors', () => {
    const { status, body } = run(new BadRequestException(['name must be a string']));
    expect(status).toBe(400);
    expect(body).toMatchObject({ code: 'VALIDATION_ERROR', details: { errors: ['name must be a string'] } });
  });

  it('hides unexpected errors behind INTERNAL_ERROR and logs them', () => {
    const { status, body, logger } = run(new Error('db password is hunter2'));
    expect(status).toBe(500);
    expect(body).toEqual({ success: false, code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: 'req-123' });
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(logger.error).toHaveBeenCalled();
  });

  it('keeps retryAfterSeconds on 429 AppExceptions', () => {
    const { body } = run(new AppException(ErrorCode.OtpCooldown, { retryAfterSeconds: 42 }));
    expect(body.details).toEqual({ retryAfterSeconds: 42 });
  });

  it('adds retryAfterSeconds to any other 429, from Retry-After when present', () => {
    expect(run(new HttpException('x', 429), { 'Retry-After': '17' }).body.details).toEqual({ retryAfterSeconds: 17 });
    expect(run(new AppException(ErrorCode.TooManyRequests)).body.details).toEqual({ retryAfterSeconds: 60 });
  });
});
