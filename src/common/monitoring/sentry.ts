import * as Sentry from '@sentry/node';
import type { Breadcrumb, ErrorEvent } from '@sentry/node';

import { redactDeep } from '../logging/redact';

export interface SentryInitOptions {
  dsn?: string;
  environment: string;
  role: string;
}

let enabled = false;

/**
 * Removes anything that could identify a person before an event leaves the
 * process: request headers, cookies, body and query string, the client IP and
 * user details (only the opaque user id may stay), and sensitive keys in
 * extra data, contexts and tags (guide §4.4, S10).
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    const url = typeof event.request.url === 'string' ? event.request.url.split('?')[0] : undefined;
    event.request = { method: event.request.method, url };
  }
  if (event.user) {
    event.user = typeof event.user.id === 'string' || typeof event.user.id === 'number' ? { id: event.user.id } : undefined;
  }
  if (event.extra) event.extra = redactDeep(event.extra);
  if (event.contexts) event.contexts = redactDeep(event.contexts);
  if (event.tags) event.tags = redactDeep(event.tags);
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  return event;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const data = breadcrumb.data ? redactDeep(breadcrumb.data) : undefined;
  if (data && typeof data.url === 'string') data.url = data.url.split('?')[0];
  return { ...breadcrumb, data };
}

/**
 * Starts Sentry only when SENTRY_DSN is set; otherwise does nothing and
 * captureException is a no-op. Errors only (no tracing), no automatic PII.
 */
export function initSentry(options: SentryInitOptions): boolean {
  if (!options.dsn) return false;
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    initialScope: { tags: { role: options.role } },
    // Collect nothing about the request or user automatically; beforeSend
    // scrubs whatever is left as a second layer.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    },
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });
  enabled = true;
  return true;
}

/** Reports an unexpected error, if Sentry is enabled. */
export function captureException(error: unknown): void {
  if (enabled) Sentry.captureException(error);
}

/** Sends buffered events before the process exits. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs);
}
