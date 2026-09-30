import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { SKIP_ALL_THROTTLERS } from '../common/throttling/throttling.constants';
import { LivenessResponse, ReadinessFailureBody, ReadinessResponse } from './dto/health.response';
import { HealthService } from './health.service';
import { NoStoreInterceptor } from './no-store.interceptor';

const NO_STORE_HEADER = { 'Cache-Control': { description: 'Always no-store', schema: { type: 'string' } } };

/**
 * Load balancer and monitoring probes (guide M02). Public: no JwtAuthGuard,
 * and both the per-IP and per-user throttlers are skipped. Request logs for
 * these paths are written at debug level only (logger.module.ts).
 */
@ApiTags('health')
@SkipThrottle(SKIP_ALL_THROTTLERS)
@UseInterceptors(NoStoreInterceptor)
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Liveness',
    description: 'Returns 200 while the process is running. Checks no dependencies. Public, never rate limited.',
  })
  @ApiOkResponse({ type: LivenessResponse, headers: NO_STORE_HEADER })
  liveness(): LivenessResponse {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness',
    description:
      'Pings MySQL (SELECT 1) and Redis (PING) in parallel, 1 s timeout each. ' +
      '503 if either is down or slow, or once the instance is shutting down. Public, never rate limited.',
  })
  @ApiOkResponse({ type: ReadinessResponse, headers: NO_STORE_HEADER })
  @ApiServiceUnavailableResponse({
    description: 'PROVIDER_UNAVAILABLE: a dependency is down or timed out, or the instance is shutting down',
    type: ReadinessFailureBody,
    headers: NO_STORE_HEADER,
  })
  readiness(): Promise<ReadinessResponse> {
    return this.health.readiness();
  }
}
