import type { Logger } from '@nestjs/common';
import type { Worker } from 'bullmq';

/**
 * Worst-case worker shutdown must fit run-role's SHUTDOWN_TIMEOUT_MS (10 s).
 * Nest destroys the relay, then the handler worker, then the scheduler, one
 * after the other: relay wait 1.5 s + queue close 0.5 s + handler drain 2.5 s
 * + scheduler drain 2.5 s + queue close 0.5 s = 7.5 s, leaving 2.5 s for the
 * Redis, MySQL and Sentry closes.
 */
export const WORKER_DRAIN_TIMEOUT_MS = 2_500;

/**
 * Stops fetching new jobs and waits for in-flight ones. If they take longer
 * than the timeout, gives up waiting: the job's lock then expires and BullMQ
 * returns it to the queue as stalled, so it is retried (handlers are idempotent).
 */
export async function closeWorker(worker: Worker, logger: Logger, timeoutMs = WORKER_DRAIN_TIMEOUT_MS): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const closed = worker.close().then(
    () => 'closed' as const,
    () => 'closed' as const,
  );
  const result = await Promise.race([closed, timedOut]);
  clearTimeout(timer);
  if (result === 'timeout') {
    logger.warn({ queue: worker.name, timeoutMs }, 'In-flight jobs did not finish in time; they will be retried');
  }
}

/** Longest a queue close may take; with Redis down, BullMQ's close() would wait for a connection forever. */
export const QUEUE_CLOSE_TIMEOUT_MS = 500;

/** Closes a BullMQ queue, giving up after the timeout. Never throws. */
export async function closeQueue(queue: { close(): Promise<void> }, timeoutMs = QUEUE_CLOSE_TIMEOUT_MS): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([queue.close().catch(() => undefined), timedOut]);
  clearTimeout(timer);
}
