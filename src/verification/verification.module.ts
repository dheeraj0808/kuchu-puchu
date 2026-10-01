import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { EventsModule } from '../events/events.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { VERIFICATION_HOOKS } from './account-hooks';
import { FaceVerification } from './models/face-verification.model';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

/**
 * M11 live verification: the selfie gate. Needs the global FaceModule,
 * StorageModule, SettingsModule, SecurityModule and AccountRegistryModule.
 * Registers its account deletion handler, export contributor and the
 * profile-creation hook that fills profiles.face_verified_at.
 */
@Module({
  imports: [SequelizeModule.forFeature([FaceVerification]), EventsModule, ProfilesModule, UsersModule],
  controllers: [VerificationController],
  providers: [VerificationService, ...VERIFICATION_HOOKS],
  exports: [VerificationService],
})
export class VerificationModule {}
