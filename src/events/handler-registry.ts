import { Injectable } from '@nestjs/common';

import { type EventPayloads, type EventType, isEventType } from './event-types';

/** What a handler receives. `payload` is exactly what the publisher wrote. */
export interface DeliveredEvent<T extends EventType = EventType> {
  outboxId: string;
  type: T;
  aggregateId: string;
  payload: EventPayloads[T];
  /** 1 on the first try, up to OUTBOX_MAX_ATTEMPTS. */
  attempt: number;
}

/**
 * Handles one event type. Each handler runs as its own BullMQ job, so it is
 * retried on its own (exponential backoff, up to OUTBOX_MAX_ATTEMPTS) and an
 * alert fires when the last attempt fails.
 *
 * HANDLERS MUST BE IDEMPOTENT. Delivery is at-least-once: a handler can run
 * twice for the same event (a retry after a partial failure, a worker killed
 * mid-job). Make the effect safe to repeat, e.g. insert with a unique key
 * such as notifications.dedupe_key = `<outboxId>`, or check-then-write inside
 * a transaction.
 *
 * Throw to fail the attempt; throw bullmq's UnrecoverableError to fail it
 * without further retries.
 */
export interface EventHandler<T extends EventType = EventType> {
  /** Unique across the app; `[a-z0-9_.]`, max 64. Part of the BullMQ jobId. */
  readonly name: string;
  readonly eventType: T;
  handle(event: DeliveredEvent<T>): Promise<void>;
}

export const HANDLER_NAME = /^[a-z0-9_.]{1,64}$/;

/**
 * Event type → named handlers. Modules register their handlers from their
 * own onModuleInit, so this module never imports them. The worker seals the
 * registry when it starts consuming; any invalid, duplicate or late
 * registration throws, which fails the worker at boot.
 */
@Injectable()
export class HandlerRegistry {
  private readonly byName = new Map<string, EventHandler>();
  private readonly byType = new Map<EventType, EventHandler[]>();
  private sealed = false;

  register<T extends EventType>(handler: EventHandler<T>): void {
    if (this.sealed) {
      throw new Error(`Handler "${handler.name}" registered after the outbox worker started`);
    }
    if (typeof handler.name !== 'string' || !HANDLER_NAME.test(handler.name)) {
      throw new Error(`Invalid handler name "${String(handler.name)}": use [a-z0-9_.], 1–64 chars`);
    }
    if (!isEventType(handler.eventType)) {
      throw new Error(`Handler "${handler.name}" is registered for an unknown event type`);
    }
    if (this.byName.has(handler.name)) {
      throw new Error(`Duplicate handler name "${handler.name}"`);
    }
    const generic = handler as unknown as EventHandler;
    this.byName.set(handler.name, generic);
    this.byType.set(handler.eventType, [...(this.byType.get(handler.eventType) ?? []), generic]);
  }

  handlersFor(type: string): readonly EventHandler[] {
    return isEventType(type) ? (this.byType.get(type) ?? []) : [];
  }

  get(name: string): EventHandler | undefined {
    return this.byName.get(name);
  }

  seal(): void {
    this.sealed = true;
  }
}
