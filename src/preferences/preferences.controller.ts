import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
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
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreatePreferencesDto } from './dto/create-preferences.dto';
import { PreferencesResponse } from './dto/preferences.response';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { PreferencesService } from './preferences.service';

@ApiTags('preferences')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@UseGuards(JwtAuthGuard)
@Controller('preferences')
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  @Get()
  @ApiOperation({ summary: 'Get dating preferences (defaults with isConfigured=false if none saved)' })
  @ApiOkResponse({ type: PreferencesResponse })
  get(@CurrentUser() user: AuthenticatedUser): Promise<PreferencesResponse> {
    return this.preferences.getOwn(user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create dating preferences (once per user)' })
  @ApiCreatedResponse({ type: PreferencesResponse })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'Preferences already exist' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePreferencesDto): Promise<PreferencesResponse> {
    return this.preferences.create(user.userId, dto);
  }

  @Patch()
  @ApiOperation({ summary: 'Partially update dating preferences' })
  @ApiOkResponse({ type: PreferencesResponse })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'Preferences not set yet' })
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdatePreferencesDto): Promise<PreferencesResponse> {
    return this.preferences.update(user.userId, dto);
  }
}
