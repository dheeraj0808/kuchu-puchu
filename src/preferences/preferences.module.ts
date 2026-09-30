import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { DatingPreference } from './models/dating-preference.model';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';

@Module({
  imports: [SequelizeModule.forFeature([DatingPreference])],
  controllers: [PreferencesController],
  providers: [PreferencesService],
  exports: [PreferencesService],
})
export class PreferencesModule {}
