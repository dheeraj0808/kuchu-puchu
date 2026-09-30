import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import type { Transaction } from 'sequelize';

import type { RequestContext } from '../common/utils/request-context';
import { SecurityEvent, SecurityEventType } from './models/security-event.model';

export interface RecordSecurityEventInput {
  eventType: SecurityEventType;
  userId?: string | null;
  context?: RequestContext;
  metadata?: Record<string, unknown>;
  transaction?: Transaction;
}

@Injectable()
export class SecurityEventsService {
  private readonly logger = new Logger(SecurityEventsService.name);

  constructor(
    @InjectModel(SecurityEvent)
    private readonly securityEventModel: typeof SecurityEvent,
  ) {}

  /**
   * Records an audit event. Failures are logged but never propagated —
   * auditing must not break the user-facing flow.
   */
  async record(input: RecordSecurityEventInput): Promise<void> {
    try {
      await this.securityEventModel.create(
        {
          eventType: input.eventType,
          userId: input.userId ?? null,
          ipAddress: input.context?.ipAddress ?? null,
          userAgent: input.context?.userAgent ?? null,
          metadata: input.metadata ?? null,
        },
        { transaction: input.transaction },
      );
    } catch (err) {
      this.logger.error(
        { eventType: input.eventType, err: (err as Error).name },
        'Failed to record security event',
      );
    }
  }
}
