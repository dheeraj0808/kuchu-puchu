import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { SessionStateModule } from '../auth/session-state/session-state.service';
import { EventsModule } from '../events/events.module';
import { User } from './models/user.model';
import { UsersService } from './users.service';

@Module({
  imports: [SequelizeModule.forFeature([User]), EventsModule, SessionStateModule],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
