import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ClientContext } from '../common/decorators/client-context.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import type { RequestContext } from '../common/utils/request-context';
import { MeResponseDto } from '../users/dto/me.response';
import { AuthService } from './auth.service';
import {
  LoginResponse,
  OtpRequestResponse,
  ReauthRequestResponse,
  ReauthVerifyResponse,
  SessionResponse,
  TokenPairResponse,
} from './dto/auth.responses';
import { LogoutDto } from './dto/logout.dto';
import { MessageResponse } from './dto/message.response';
import { OtpRequestDto } from './dto/otp-request.dto';
import { OtpVerifyDto } from './dto/otp-verify.dto';
import { ReauthRequestDto, ReauthVerifyDto } from './dto/reauth.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthenticatedUser } from './interfaces/authenticated-user.interface';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The 10 endpoints of guide M06. */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Send a sign-in code by SMS or email',
    description: 'Always the same 200 body, whether or not an account exists for the identifier.',
  })
  @ApiOkResponse({ type: OtpRequestResponse })
  @ApiBadRequestResponse({ description: 'VALIDATION_ERROR' })
  @ApiTooManyRequestsResponse({ description: 'OTP_COOLDOWN or TOO_MANY_REQUESTS, with details.retryAfterSeconds' })
  @ApiServiceUnavailableResponse({ description: 'OTP_DELIVERY_FAILED' })
  requestOtp(@Body() dto: OtpRequestDto, @ClientContext() ctx: RequestContext): Promise<OtpRequestResponse> {
    return this.auth.requestOtp(dto, ctx);
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify a sign-in code; creates the account on first login and opens a session for the device' })
  @ApiOkResponse({ type: LoginResponse })
  @ApiUnauthorizedResponse({ description: 'OTP_INVALID (the same for every reason)' })
  @ApiForbiddenResponse({ description: 'ACCOUNT_RESTRICTED: suspended or banned; no tokens' })
  @ApiTooManyRequestsResponse({ description: 'TOO_MANY_REQUESTS' })
  verifyOtp(@Body() dto: OtpVerifyDto, @ClientContext() ctx: RequestContext): Promise<LoginResponse> {
    return this.auth.verifyOtp(dto, ctx);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Rotate the refresh token and get a new pair',
    description: 'Replaying an old refresh token signs the account out on every device.',
  })
  @ApiOkResponse({ type: TokenPairResponse })
  @ApiUnauthorizedResponse({ description: 'UNAUTHORIZED' })
  @ApiForbiddenResponse({ description: 'ACCOUNT_RESTRICTED' })
  refresh(@Body() dto: RefreshTokenDto, @ClientContext() ctx: RequestContext): Promise<TokenPairResponse> {
    return this.auth.refresh(dto, ctx);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the session of a refresh token. Always 200' })
  @ApiOkResponse({ type: MessageResponse })
  logout(@Body() dto: LogoutDto, @ClientContext() ctx: RequestContext): Promise<MessageResponse> {
    return this.auth.logout(dto, ctx);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke every session of the caller, including this one' })
  @ApiOkResponse({ type: MessageResponse })
  @ApiUnauthorizedResponse({ description: 'UNAUTHORIZED' })
  logoutAll(@CurrentUser() user: AuthenticatedUser, @ClientContext() ctx: RequestContext): Promise<MessageResponse> {
    return this.auth.logoutAll(user, ctx);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Account summary, profile and the next onboarding step' })
  @ApiOkResponse({ type: MeResponseDto })
  @ApiUnauthorizedResponse({ description: 'UNAUTHORIZED' })
  @ApiForbiddenResponse({ description: 'ACCOUNT_RESTRICTED' })
  me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponseDto> {
    return this.auth.me(user);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Devices signed in to this account, most recently used first' })
  @ApiOkResponse({ type: SessionResponse, isArray: true })
  @ApiUnauthorizedResponse({ description: 'UNAUTHORIZED' })
  sessions(@CurrentUser() user: AuthenticatedUser): Promise<SessionResponse[]> {
    return this.auth.listSessions(user);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ user: { limit: 20, ttl: 60_000 } })
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'sessionId', format: 'uuid' })
  @ApiOperation({ summary: "Revoke one of the caller's sessions" })
  @ApiOkResponse({ type: MessageResponse })
  @ApiUnauthorizedResponse({ description: 'UNAUTHORIZED' })
  @ApiNotFoundResponse({ description: "NOT_FOUND: not one of the caller's live sessions" })
  revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
    @ClientContext() ctx: RequestContext,
  ): Promise<MessageResponse> {
    // A malformed id can't be anyone's session: the same 404 as someone else's.
    if (!UUID.test(sessionId)) throw new AppException(ErrorCode.NotFound);
    return this.auth.revokeSession(user, sessionId, ctx);
  }

  @Post('reauth/request')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ user: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: "Send a step-up code to the account's own verified phone or email" })
  @ApiOkResponse({ type: ReauthRequestResponse })
  @ApiBadRequestResponse({ description: 'VALIDATION_ERROR: the channel is not verified on this account' })
  @ApiUnauthorizedResponse({ description: 'UNAUTHORIZED' })
  @ApiTooManyRequestsResponse({ description: 'OTP_COOLDOWN or TOO_MANY_REQUESTS' })
  @ApiServiceUnavailableResponse({ description: 'OTP_DELIVERY_FAILED' })
  reauthRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReauthRequestDto,
    @ClientContext() ctx: RequestContext,
  ): Promise<ReauthRequestResponse> {
    return this.auth.reauthRequest(user, dto, ctx);
  }

  @Post('reauth/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ user: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Verify the step-up code; sensitive actions are allowed on this session for 10 minutes' })
  @ApiOkResponse({ type: ReauthVerifyResponse })
  @ApiUnauthorizedResponse({ description: 'OTP_INVALID for a wrong code; UNAUTHORIZED for a bad session' })
  reauthVerify(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReauthVerifyDto,
    @ClientContext() ctx: RequestContext,
  ): Promise<ReauthVerifyResponse> {
    return this.auth.reauthVerify(user, dto, ctx);
  }
}
