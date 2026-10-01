import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestContext } from '../common/utils/request-context';
import { CompleteFaceSessionDto, StartFaceSessionDto } from './dto/face-session.dto';
import { FaceCompleteResponse, FaceSessionResponse, VerificationStatusResponse } from './dto/verification.responses';
import { SESSION_COMPLETE_LIMIT, SESSION_CREATE_LIMIT } from './verification.constants';
import { VerificationService } from './verification.service';

const QUOTA =
  'VERIFICATION_ATTEMPTS_EXCEEDED: 3 decided attempts per rolling 24 h or 10 in total (details.retryAfterSeconds, details.limit, details.support). TOO_MANY_REQUESTS: HTTP rate limit (details.retryAfterSeconds).';
const PROVIDER = 'PROVIDER_UNAVAILABLE: the liveness provider failed or timed out. The attempt is not counted; try again.';

@ApiTags('verification')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('verification')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get()
  @ApiOperation({ summary: 'Verification status', description: 'The live selfie status and the attempts left. ID verification (M23) is added here later.' })
  @ApiOkResponse({ type: VerificationStatusResponse })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  status(@CurrentUser() user: AuthenticatedUser): Promise<VerificationStatusResponse> {
    return this.verification.getStatus(user.userId);
  }

  @Post('face/session')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ user: SESSION_CREATE_LIMIT })
  @ApiOperation({
    summary: 'Start a live selfie session',
    description:
      'Show the consent screen first and send its version. Creates a liveness session at the provider and returns the token for its capture SDK. Starting a new session ends any older one that was not completed.',
  })
  @ApiCreatedResponse({ type: FaceSessionResponse })
  @ApiBadRequestResponse({ description: 'VALIDATION_ERROR: consentVersion missing or not accepted' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiConflictResponse({ description: 'VERIFICATION_STATE_CONFLICT: already approved, or waiting for review (details.status)' })
  @ApiTooManyRequestsResponse({ description: QUOTA })
  @ApiServiceUnavailableResponse({ description: PROVIDER })
  startSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartFaceSessionDto,
    @ClientContext() ctx: RequestContext,
  ): Promise<FaceSessionResponse> {
    return this.verification.startFaceSession(user.userId, dto.consentVersion, ctx);
  }

  @Post('face/complete')
  @HttpCode(HttpStatus.OK)
  @Throttle({ user: SESSION_COMPLETE_LIMIT })
  @ApiOperation({
    summary: 'Finish a live selfie session',
    description:
      'Call after the capture SDK finishes. The server fetches the result from the provider and decides; nothing in the body but sessionId is accepted. Calling it again for a decided session returns the same decision without using an attempt.',
  })
  @ApiOkResponse({ type: FaceCompleteResponse })
  @ApiBadRequestResponse({ description: 'VALIDATION_ERROR: sessionId missing or not a UUID, or any other field sent' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND: no such session for this user' })
  @ApiTooManyRequestsResponse({ description: QUOTA })
  @ApiServiceUnavailableResponse({ description: PROVIDER })
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CompleteFaceSessionDto,
    @ClientContext() ctx: RequestContext,
  ): Promise<FaceCompleteResponse> {
    return this.verification.completeFaceSession(user.userId, dto.sessionId, ctx);
  }
}
