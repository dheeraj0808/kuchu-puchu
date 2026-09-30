import { ApiProperty } from '@nestjs/swagger';

import { InterestResponse } from '../../interests/dto/interest.response';
import { PreferencesResponse } from '../../preferences/dto/preferences.response';
import type { Profile } from '../models/profile.model';
import type { ProfileCompletionResponse } from './profile-completion.response';
import { ProfileResponse } from './profile.response';

/** GET /api/profile: the owner's full profile incl. interests and preferences. */
export class ProfileDetailResponse extends ProfileResponse {
  @ApiProperty({ type: [InterestResponse] }) interests: InterestResponse[];
  @ApiProperty({ type: PreferencesResponse }) preferences: PreferencesResponse;

  static build(
    p: Profile,
    completion: ProfileCompletionResponse,
    interests: InterestResponse[],
    preferences: PreferencesResponse,
  ): ProfileDetailResponse {
    const dto = ProfileResponse.fill(new ProfileDetailResponse(), p, completion);
    dto.interests = interests;
    dto.preferences = preferences;
    return dto;
  }
}
