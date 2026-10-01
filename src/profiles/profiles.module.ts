import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { InterestsModule } from '../interests/interests.module';
import { PreferencesModule } from '../preferences/preferences.module';
import { PROFILE_ACCOUNT_HOOKS } from './account-hooks';
import { Profile } from './models/profile.model';
import { ProfileCompletionService } from './profile-completion.service';
import { ProfileInterestsController } from './profile-interests.controller';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

// JwtAuthGuard has no injected deps; the 'jwt' passport strategy is registered by AuthModule.
@Module({
  imports: [SequelizeModule.forFeature([Profile]), InterestsModule, PreferencesModule],
  // ProfileInterestsController first so /profile/interests is matched before any /profile/:param route.
  controllers: [ProfileInterestsController, ProfilesController],
  providers: [ProfilesService, ProfileCompletionService, ...PROFILE_ACCOUNT_HOOKS],
  exports: [ProfilesService],
})
export class ProfilesModule {}
