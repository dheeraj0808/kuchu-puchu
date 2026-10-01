import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { PREFERENCES_ACCOUNT_HOOKS } from './account-hooks';
import { DatingPreference } from './models/dating-preference.model';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';

@Module({
  imports: [SequelizeModule.forFeature([DatingPreference])],
  controllers: [PreferencesController],
  providers: [PreferencesService, ...PREFERENCES_ACCOUNT_HOOKS],
  exports: [PreferencesService],
})
export class PreferencesModule {}
