import type { IncomingMessage } from 'node:http';

import { API_PREFIX } from '../constants';

/** Liveness and readiness (M02), with or without a trailing slash or query string. */
const HEALTH_CHECK_PATH = new RegExp(`^/${API_PREFIX}/health(?:/ready)?/?$`, 'i');

export function isHealthCheckPath(url: string | undefined): boolean {
  return HEALTH_CHECK_PATH.test((url ?? '').split('?')[0]);
}

/**
 * Level of the per-request log line. Load balancer probes hit the health
 * endpoints every few seconds, so they are logged at debug only.
 */
export function requestLogLevel(req: IncomingMessage): 'debug' | 'info' {
  const url = (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url;
  return isHealthCheckPath(url) ? 'debug' : 'info';
}
