import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MessageResponse } from '../auth/dto/message.response';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestContext } from '../common/utils/request-context';
import { CreateProfileDto } from './dto/create-profile.dto';
import { ProfileCompletionResponse } from './dto/profile-completion.response';
import { ProfileDetailResponse } from './dto/profile-detail.response';
import { ProfileResponse } from './dto/profile.response';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfilesService } from './profiles.service';

@ApiTags('profile')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  @ApiOperation({ summary: "Get the current user's profile, interests and preferences" })
  @ApiOkResponse({ type: ProfileDetailResponse })
  @ApiNotFoundResponse({ description: 'Profile not created yet' })
  get(@CurrentUser() user: AuthenticatedUser): Promise<ProfileDetailResponse> {
    return this.profiles.getOwn(user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create the current user profile (onboarding)' })
  @ApiCreatedResponse({ type: ProfileResponse })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'Profile already exists' })
  @ApiUnprocessableEntityResponse({ description: 'Date of birth cannot be changed' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProfileDto,
    @ClientContext() ctx: RequestContext,
  ): Promise<ProfileResponse> {
    return this.profiles.create(user.userId, dto, ctx);
  }

  @Patch()
  @ApiOperation({ summary: 'Update the current user profile (dateOfBirth is not updatable)' })
  @ApiOkResponse({ type: ProfileResponse })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'Profile not created yet' })
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto): Promise<ProfileResponse> {
    return this.profiles.update(user.userId, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate and remove the current user profile (account is kept)' })
  @ApiOkResponse({ type: MessageResponse })
  @ApiNotFoundResponse({ description: 'Profile not found' })
  async remove(@CurrentUser() user: AuthenticatedUser, @ClientContext() ctx: RequestContext): Promise<MessageResponse> {
    await this.profiles.remove(user.userId, ctx);
    return { message: 'Profile deleted' };
  }

  @Get('completion')
  @ApiOperation({ summary: 'Server-computed profile completion' })
  @ApiOkResponse({ type: ProfileCompletionResponse })
  completion(@CurrentUser() user: AuthenticatedUser): Promise<ProfileCompletionResponse> {
    return this.profiles.getCompletion(user.userId);
  }
}
