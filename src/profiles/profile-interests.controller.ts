import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProfileInterestsResponse } from '../interests/dto/profile-interests.response';
import { UpdateProfileInterestsDto } from '../interests/dto/update-profile-interests.dto';
import { ProfilesService } from './profiles.service';

@ApiTags('profile')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@UseGuards(JwtAuthGuard)
@Controller('profile/interests')
export class ProfileInterestsController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  @ApiOperation({ summary: "Get the current user's selected interests (empty before onboarding)" })
  @ApiOkResponse({ type: ProfileInterestsResponse })
  get(@CurrentUser() user: AuthenticatedUser): Promise<ProfileInterestsResponse> {
    return this.profiles.getOwnInterests(user.userId);
  }

  @Put()
  @ApiOperation({ summary: 'Replace the selected interests atomically (empty array clears)' })
  @ApiOkResponse({ type: ProfileInterestsResponse })
  @ApiBadRequestResponse({ description: 'Invalid, inactive, duplicate or too many interests' })
  @ApiNotFoundResponse({ description: 'Profile not created yet' })
  replace(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileInterestsDto,
  ): Promise<ProfileInterestsResponse> {
    return this.profiles.replaceOwnInterests(user.userId, dto.interestIds);
  }
}
