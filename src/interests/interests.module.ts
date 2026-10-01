import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { INTERESTS_ACCOUNT_HOOKS } from './account-hooks';
import { InterestsService } from './interests.service';
import { Interest } from './models/interest.model';
import { ProfileInterest } from './models/profile-interest.model';

@Module({
  imports: [SequelizeModule.forFeature([Interest, ProfileInterest])],
  providers: [InterestsService, ...INTERESTS_ACCOUNT_HOOKS],
  exports: [InterestsService],
})
export class InterestsModule {}
