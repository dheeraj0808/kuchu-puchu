import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

type RequestWithId = IncomingMessage & { id?: unknown };

/** Accepts a well-formed incoming x-request-id, otherwise generates one. */
export function resolveRequestId(req: RequestWithId): string {
  if (typeof req.id === 'string') return req.id;
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
    ? incoming
    : randomUUID();
}

/**
 * Registered first, so every response carries a request id, including errors
 * raised by raw middleware (body parsing) before Nest's logger middleware runs.
 * pino-http reuses `req.id` when it is already set.
 */
export function requestIdMiddleware(
  req: RequestWithId,
  res: ServerResponse,
  next: () => void,
): void {
  const id = resolveRequestId(req);
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
}
