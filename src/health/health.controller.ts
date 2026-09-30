import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { SKIP_ALL_THROTTLERS } from '../common/throttling/throttling.constants';

@ApiTags('health')
@SkipThrottle(SKIP_ALL_THROTTLERS)
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({ description: 'Service is up' })
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
