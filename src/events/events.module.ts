import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';

import type { OutboxConfig } from '../config/outbox.config';
import { OutboxEvent } from './models/outbox-event.model';
import { OUTBOX_CONFIG } from './outbox.constants';
import { OutboxService } from './outbox.service';

/**
 * Publishing side of the outbox. Safe to import from API modules: it only
 * writes rows in the caller's transaction and never touches Redis.
 */
@Module({
  imports: [SequelizeModule.forFeature([OutboxEvent])],
  providers: [
    {
      provide: OUTBOX_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): OutboxConfig => config.getOrThrow<OutboxConfig>('outbox'),
    },
    OutboxService,
  ],
  exports: [OutboxService, OUTBOX_CONFIG],
})
export class EventsModule {}
