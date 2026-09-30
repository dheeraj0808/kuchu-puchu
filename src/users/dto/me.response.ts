import { ApiProperty } from '@nestjs/swagger';

import { ProfileResponse } from '../../profiles/dto/profile.response';
import type { User } from '../models/user.model';
import { UserResponseDto } from './user-response.dto';

/** GET /auth/me: basic account info plus the owner's profile (null until onboarding). */
export class MeResponseDto extends UserResponseDto {
  @ApiProperty({ type: ProfileResponse, nullable: true })
  profile: ProfileResponse | null;

  static fromUserAndProfile(user: User, profile: ProfileResponse | null): MeResponseDto {
    return Object.assign(new MeResponseDto(), UserResponseDto.fromModel(user), { profile });
  }
}
