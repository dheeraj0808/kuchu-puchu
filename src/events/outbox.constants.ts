/** Injection token for the typed OutboxConfig. */
export const OUTBOX_CONFIG = Symbol('OUTBOX_CONFIG');

/** Injection token for the BullMQ queue that carries one job per (event, handler). */
export const OUTBOX_QUEUE = Symbol('OUTBOX_QUEUE');

/** BullMQ queue name; keys live under kp:queue:outbox-events:… */
export const OUTBOX_QUEUE_NAME = 'outbox-events';

/** Parallel handler jobs per worker process. */
export const OUTBOX_HANDLER_CONCURRENCY = 10;

/** `<outboxId>-<handlerName>`: unique per pair, so a re-enqueue is deduplicated by BullMQ. */
export function outboxJobId(outboxId: string, handlerName: string): string {
  return `${outboxId}-${handlerName}`;
}
