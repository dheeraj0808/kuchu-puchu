import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { RequestContext } from '../utils/request-context';

const MAX_UA_LENGTH = 512;

export function extractRequestContext(req: Request): RequestContext {
  const ua = req.headers['user-agent'];
  return {
    // req.ip honours the `trust proxy` setting configured in main.ts.
    ipAddress: req.ip ?? null,
    userAgent: typeof ua === 'string' ? ua.slice(0, MAX_UA_LENGTH) : null,
  };
}

/** Injects `{ ipAddress, userAgent }` of the current request. */
export const ClientContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext =>
    extractRequestContext(ctx.switchToHttp().getRequest<Request>()),
);
