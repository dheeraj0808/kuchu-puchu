import { Injectable } from '@nestjs/common';

/** Onboarding order from guide M06: selfie → photos → profile → preferences → done. */
export type OnboardingStep = 'selfie' | 'photos' | 'profile' | 'preferences' | 'done';

export const ONBOARDING_STEPS = ['selfie', 'photos', 'profile', 'preferences', 'done'] as const satisfies readonly OnboardingStep[];

/** Whether one onboarding step is finished for a user. One small provider per step, owned by its module. */
export interface OnboardingStepProvider {
  isDone(userId: string): Promise<boolean>;
}

/** Live selfie approved (M11). Until M11 the stub answers "not done". */
export abstract class SelfieStepProvider implements OnboardingStepProvider {
  abstract isDone(userId: string): Promise<boolean>;
}

/** Enough approved photos (M12). Until M12 the stub answers "not done". */
export abstract class PhotosStepProvider implements OnboardingStepProvider {
  abstract isDone(userId: string): Promise<boolean>;
}

/** A profile exists (M09). */
export abstract class ProfileStepProvider implements OnboardingStepProvider {
  abstract isDone(userId: string): Promise<boolean>;
}

/** Dating preferences are saved (M10). */
export abstract class PreferencesStepProvider implements OnboardingStepProvider {
  abstract isDone(userId: string): Promise<boolean>;
}

export interface OnboardingStatus {
  /** The live selfie is approved (guide: "Verified user"). */
  selfieApproved: boolean;
  nextStep: OnboardingStep;
}

/**
 * Computes the next onboarding step from state (guide M06). Steps are checked
 * in order and the first one not done is the answer, so later providers are
 * only asked once the earlier steps are done.
 */
@Injectable()
export class OnboardingService {
  private readonly steps: ReadonlyArray<[Exclude<OnboardingStep, 'done'>, OnboardingStepProvider]>;

  constructor(
    selfie: SelfieStepProvider,
    photos: PhotosStepProvider,
    profile: ProfileStepProvider,
    preferences: PreferencesStepProvider,
  ) {
    this.steps = [
      ['selfie', selfie],
      ['photos', photos],
      ['profile', profile],
      ['preferences', preferences],
    ];
  }

  async nextStep(userId: string): Promise<OnboardingStep> {
    for (const [step, provider] of this.steps) {
      if (!(await provider.isDone(userId))) return step;
    }
    return 'done';
  }

  async status(userId: string): Promise<OnboardingStatus> {
    const nextStep = await this.nextStep(userId);
    // The steps run in order, so nextStep is past "selfie" only once the selfie is done.
    return { selfieApproved: nextStep !== 'selfie', nextStep };
  }
}
