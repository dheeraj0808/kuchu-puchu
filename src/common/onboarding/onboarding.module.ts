import { Global, Injectable, Module } from '@nestjs/common';

import { PreferencesModule } from '../../preferences/preferences.module';
import { PreferencesService } from '../../preferences/preferences.service';
import { ProfilesModule } from '../../profiles/profiles.module';
import { ProfilesService } from '../../profiles/profiles.service';
import { VerificationModule } from '../../verification/verification.module';
import { VerificationService } from '../../verification/verification.service';
import {
  OnboardingService,
  PhotosStepProvider,
  PreferencesStepProvider,
  ProfileStepProvider,
  SelfieStepProvider,
} from './onboarding.service';

/** M11: the live selfie is approved (moderation can withdraw it with requireReverification). */
@Injectable()
export class SelfieApprovedStep extends SelfieStepProvider {
  constructor(private readonly verification: VerificationService) {
    super();
  }

  isDone(userId: string): Promise<boolean> {
    return this.verification.isFaceApproved(userId);
  }
}

/** Stub until M12 (photos). */
@Injectable()
export class PendingPhotosStep extends PhotosStepProvider {
  isDone(_userId: string): Promise<boolean> {
    return Promise.resolve(false);
  }
}

@Injectable()
export class ProfileExistsStep extends ProfileStepProvider {
  constructor(private readonly profiles: ProfilesService) {
    super();
  }

  async isDone(userId: string): Promise<boolean> {
    return (await this.profiles.findByUserId(userId)) !== null;
  }
}

@Injectable()
export class PreferencesSavedStep extends PreferencesStepProvider {
  constructor(private readonly preferences: PreferencesService) {
    super();
  }

  async isDone(userId: string): Promise<boolean> {
    return (await this.preferences.findByUserId(userId)) !== null;
  }
}

/**
 * OnboardingService for the API (guide M06). The selfie step is M11's real
 * approval state; M12 replaces the photo stub here without changing callers.
 */
@Global()
@Module({
  imports: [VerificationModule, ProfilesModule, PreferencesModule],
  providers: [
    OnboardingService,
    { provide: SelfieStepProvider, useClass: SelfieApprovedStep },
    { provide: PhotosStepProvider, useClass: PendingPhotosStep },
    { provide: ProfileStepProvider, useClass: ProfileExistsStep },
    { provide: PreferencesStepProvider, useClass: PreferencesSavedStep },
  ],
  exports: [OnboardingService],
})
export class OnboardingModule {}
