import type { Request, Response } from 'express';

import { AppException, ErrorCode } from '../exceptions/app.exception';
import { bodyParserErrorsMiddleware } from './body-parser-errors.middleware';

function passed(err: unknown): unknown {
  const next = jest.fn();
  bodyParserErrorsMiddleware(err, {} as Request, {} as Response, next);
  return next.mock.calls[0][0];
}

describe('bodyParserErrorsMiddleware', () => {
  it('maps malformed JSON to VALIDATION_ERROR', () => {
    const out = passed(Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed', status: 400 }));
    expect(out).toBeInstanceOf(AppException);
    expect((out as AppException).code).toBe(ErrorCode.ValidationError);
  });

  it('maps an oversized body to PAYLOAD_TOO_LARGE (413)', () => {
    const out = passed({ type: 'entity.too.large', status: 413 }) as AppException;
    expect(out.code).toBe(ErrorCode.PayloadTooLarge);
    expect(out.getStatus()).toBe(413);
  });

  it('maps other client-side parser errors to INVALID_REQUEST', () => {
    expect((passed({ type: 'encoding.unsupported', status: 415 }) as AppException).code).toBe(ErrorCode.InvalidRequest);
  });

  it('passes unrelated errors through untouched', () => {
    const err = new Error('boom');
    expect(passed(err)).toBe(err);
  });
});
