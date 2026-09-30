import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PreferencesModule } from '../preferences/preferences.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

@Module({
  imports: [AuthModule, ProfilesModule, PreferencesModule, UsersModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
