import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';

import type { OutboxConfig } from '../config/outbox.config';
import { type EventPayloads, type EventType, isEventType } from './event-types';
import { OutboxEvent, OutboxStatus } from './models/outbox-event.model';
import { OUTBOX_CONFIG } from './outbox.constants';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A programming error in a publisher. Never shown to clients (surfaces as INTERNAL_ERROR). */
export class OutboxPublishError extends Error {
  override readonly name = 'OutboxPublishError';
}

/**
 * Writes domain events (guide M03). The event row is part of the caller's
 * transaction: it is delivered only if that transaction commits. There is no
 * way to publish outside one.
 */
@Injectable()
export class OutboxService {
  constructor(
    @InjectModel(OutboxEvent) private readonly outboxModel: typeof OutboxEvent,
    @Inject(OUTBOX_CONFIG) private readonly cfg: OutboxConfig,
  ) {}

  async publish<T extends EventType>(
    type: T,
    aggregateId: string,
    payload: EventPayloads[T],
    transaction: Transaction,
  ): Promise<string> {
    if (!(transaction instanceof Transaction)) {
      throw new OutboxPublishError('OutboxService.publish must be called inside the caller’s transaction');
    }
    if ((transaction as Transaction & { finished?: string }).finished) {
      throw new OutboxPublishError('OutboxService.publish was given a transaction that has already finished');
    }
    if (!isEventType(type)) {
      throw new OutboxPublishError('Unknown event type');
    }
    if (typeof aggregateId !== 'string' || !UUID.test(aggregateId)) {
      throw new OutboxPublishError('aggregateId must be a lower-case UUID');
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new OutboxPublishError('payload must be an object');
    }
    const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    if (bytes > this.cfg.payloadMaxBytes) {
      throw new OutboxPublishError(`payload is ${bytes} bytes; the limit is ${this.cfg.payloadMaxBytes}`);
    }

    const row = await this.outboxModel.create(
      { eventType: type, aggregateId, payload, status: OutboxStatus.Pending, attempts: 0 },
      { transaction },
    );
    return String(row.id);
  }
}
