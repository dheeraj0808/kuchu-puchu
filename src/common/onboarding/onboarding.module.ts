import { Global, Injectable, Module } from '@nestjs/common';

import { PreferencesModule } from '../../preferences/preferences.module';
import { PreferencesService } from '../../preferences/preferences.service';
import { ProfilesModule } from '../../profiles/profiles.module';
import { ProfilesService } from '../../profiles/profiles.service';
import {
  OnboardingService,
  PhotosStepProvider,
  PreferencesStepProvider,
  ProfileStepProvider,
  SelfieStepProvider,
} from './onboarding.service';

/** Stub until M11 (live verification): nobody has an approved selfie yet. */
@Injectable()
export class PendingSelfieStep extends SelfieStepProvider {
  isDone(_userId: string): Promise<boolean> {
    return Promise.resolve(false);
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
 * OnboardingService for the API (guide M06). M11 and M12 replace the selfie
 * and photo stubs here without changing callers.
 */
@Global()
@Module({
  imports: [ProfilesModule, PreferencesModule],
  providers: [
    OnboardingService,
    { provide: SelfieStepProvider, useClass: PendingSelfieStep },
    { provide: PhotosStepProvider, useClass: PendingPhotosStep },
    { provide: ProfileStepProvider, useClass: ProfileExistsStep },
    { provide: PreferencesStepProvider, useClass: PreferencesSavedStep },
  ],
  exports: [OnboardingService],
})
export class OnboardingModule {}
