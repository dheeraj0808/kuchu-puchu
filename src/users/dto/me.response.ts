import { ApiProperty } from '@nestjs/swagger';

import { type OnboardingStep, ONBOARDING_STEPS } from '../../common/onboarding/onboarding.service';
import { ProfileResponse } from '../../profiles/dto/profile.response';
import type { User } from '../models/user.model';
import { UserResponseDto } from './user-response.dto';

/** GET /auth/me: account summary, the owner's profile (null until onboarding) and the next onboarding step. */
export class MeResponseDto extends UserResponseDto {
  @ApiProperty({ type: ProfileResponse, nullable: true })
  profile: ProfileResponse | null;

  @ApiProperty({ enum: ONBOARDING_STEPS })
  nextStep: OnboardingStep;

  static fromUserAndProfile(user: User, profile: ProfileResponse | null, nextStep: OnboardingStep): MeResponseDto {
    return Object.assign(new MeResponseDto(), UserResponseDto.fromModel(user), { profile, nextStep });
  }
}
