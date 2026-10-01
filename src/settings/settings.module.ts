import { Global, Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { AppSetting } from './models/app-setting.model';
import { SettingsService } from './settings.service';

/** Global: every module reads tunable limits through SettingsService. */
@Global()
@Module({
  imports: [SequelizeModule.forFeature([AppSetting])],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
