import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CatalogService } from './catalog.service';
import { AppConfigResponse, InterestCategoryResponse, PromptResponse } from './dto/catalog.responses';

@ApiTags('catalog')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@UseGuards(JwtAuthGuard)
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('interests')
  @ApiOperation({ summary: 'Active interests grouped by category', description: 'Cached for 10 minutes.' })
  @ApiOkResponse({ type: [InterestCategoryResponse] })
  interests(): Promise<InterestCategoryResponse[]> {
    return this.catalog.interests();
  }

  @Get('prompts')
  @ApiOperation({ summary: 'Active profile prompt questions', description: 'Cached for 10 minutes.' })
  @ApiOkResponse({ type: [PromptResponse] })
  prompts(): Promise<PromptResponse[]> {
    return this.catalog.prompts();
  }
}

@ApiTags('app')
@Controller('app')
export class AppConfigController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('config')
  // Public: its own per-IP limit on top of the global one; clients may cache it for a minute.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({
    summary: 'Public app config (no sign-in)',
    description:
      'Minimum app version per platform (force update), maintenance flag, public feature flags and support links. Cached for 10 minutes. The API never blocks requests for maintenance or old versions: the app decides.',
  })
  @ApiOkResponse({ type: AppConfigResponse })
  config(): Promise<AppConfigResponse> {
    return this.catalog.appConfig();
  }
}
