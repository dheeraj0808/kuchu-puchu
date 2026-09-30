import { Global, Injectable, Module } from '@nestjs/common';

/** Onboarding order from guide M06: selfie → photos → profile → preferences → done. */
export type OnboardingStep = 'selfie' | 'photos' | 'profile' | 'preferences' | 'done';

export interface OnboardingStatus {
  /** The live selfie is approved (guide: "Verified user"). */
  selfieApproved: boolean;
  nextStep: OnboardingStep;
}

/**
 * Where VerifiedUserGuard reads a user's verification state. Inject this
 * abstract class; M11 (live verification) and M06 (nextStep) replace the
 * provider in OnboardingModule without changing callers.
 */
export abstract class OnboardingStatusService {
  abstract getStatus(userId: string): Promise<OnboardingStatus>;
}

/** Stub until M11: nobody has an approved selfie yet. */
@Injectable()
export class SelfiePendingOnboardingStatusService extends OnboardingStatusService {
  getStatus(_userId: string): Promise<OnboardingStatus> {
    return Promise.resolve({ selfieApproved: false, nextStep: 'selfie' });
  }
}

@Global()
@Module({
  providers: [{ provide: OnboardingStatusService, useClass: SelfiePendingOnboardingStatusService }],
  exports: [OnboardingStatusService],
})
export class OnboardingModule {}
