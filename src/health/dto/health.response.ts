import { ApiProperty } from '@nestjs/swagger';

export type CheckStatus = 'up' | 'down';

export class LivenessResponse {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status: 'ok';
}

export class ReadinessChecks {
  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  mysql: CheckStatus;

  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  redis: CheckStatus;
}

export class ReadinessResponse {
  @ApiProperty({ enum: ['ready'], example: 'ready' })
  status: 'ready';

  @ApiProperty({ type: ReadinessChecks })
  checks: ReadinessChecks;
}

class ReadinessFailureDetails {
  @ApiProperty({
    type: ReadinessChecks,
    required: false,
    description: 'Set when a check failed or timed out',
    example: { mysql: 'down', redis: 'up' },
  })
  checks?: ReadinessChecks;

  @ApiProperty({
    enum: ['shutting_down'],
    required: false,
    description: 'Set instead of checks once the instance has received SIGTERM',
  })
  status?: 'shutting_down';
}

/** The §4.1 error body as readiness returns it with 503. */
export class ReadinessFailureBody {
  @ApiProperty({ enum: [false] })
  success: false;

  @ApiProperty({ enum: ['PROVIDER_UNAVAILABLE'] })
  code: 'PROVIDER_UNAVAILABLE';

  @ApiProperty()
  message: string;

  @ApiProperty({ type: ReadinessFailureDetails })
  details: ReadinessFailureDetails;

  @ApiProperty()
  requestId: string;
}
