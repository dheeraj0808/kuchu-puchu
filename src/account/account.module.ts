import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { DataExportsModule } from './data-export.service';

/**
 * API side of M07. AuthModule gives the guards only: AccountService runs
 * every module's deletion handler through AccountDeletionRegistry and imports
 * none of them.
 */
@Module({
  imports: [AuthModule, EventsModule, DataExportsModule],
  controllers: [AccountController],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
