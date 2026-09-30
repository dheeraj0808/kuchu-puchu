import { Global, Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { SecurityEvent } from './models/security-event.model';
import { SecurityEventsService } from './security-events.service';

@Global()
@Module({
  imports: [SequelizeModule.forFeature([SecurityEvent])],
  providers: [SecurityEventsService],
  exports: [SecurityEventsService],
})
export class SecurityModule {}
