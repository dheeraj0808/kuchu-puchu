import { UnrecoverableError } from 'bullmq';

import { errorClassOf } from '../infra/alerts/alert.provider';

/**
 * BullMQ stores a failed job's message (and stack) in Redis for the whole
 * failed-job retention. Messages can carry user data (e.g. a MySQL
 * "Duplicate entry 'user@example.com'"), so a job rethrows only the error
 * class. UnrecoverableError is kept, so "do not retry" still works.
 */
export function sanitizeJobError(err: unknown): Error {
  const errorClass = errorClassOf(err);
  if (err instanceof UnrecoverableError || (err as Error | null)?.name === 'UnrecoverableError') {
    return new UnrecoverableError(errorClass);
  }
  const safe = new Error(errorClass);
  safe.name = errorClass;
  return safe;
}
