import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ClientContext } from '../common/decorators/client-context.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestContext } from '../common/utils/request-context';
import { MeResponseDto } from '../users/dto/me.response';
import { AuthService } from './auth.service';
import { AuthTokensResponse } from './dto/auth-tokens.response';
import { LogoutDto } from './dto/logout.dto';
import { MessageResponse } from './dto/message.response';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { RequestOtpResponse } from './dto/request-otp.response';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthenticatedUser } from './interfaces/authenticated-user.interface';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('request-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request a one-time verification code via email or SMS' })
  @ApiOkResponse({ type: RequestOtpResponse })
  @ApiTooManyRequestsResponse({ description: 'Cooldown or rate limit reached' })
  @ApiServiceUnavailableResponse({ description: 'Code could not be delivered' })
  requestOtp(@Body() dto: RequestOtpDto, @ClientContext() ctx: RequestContext): Promise<RequestOtpResponse> {
    return this.auth.requestOtp(dto, ctx);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify a code; signs in or registers the user' })
  @ApiOkResponse({ type: AuthTokensResponse })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired verification code' })
  @ApiForbiddenResponse({ description: 'Account restricted' })
  verifyOtp(@Body() dto: VerifyOtpDto, @ClientContext() ctx: RequestContext): Promise<AuthTokensResponse> {
    return this.auth.verifyOtp(dto, ctx);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate the refresh token and issue a new access token' })
  @ApiOkResponse({ type: AuthTokensResponse })
  @ApiUnauthorizedResponse({ description: 'Invalid refresh token' })
  refresh(@Body() dto: RefreshTokenDto, @ClientContext() ctx: RequestContext): Promise<AuthTokensResponse> {
    return this.auth.refresh(dto, ctx);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the session bound to a refresh token (idempotent)' })
  @ApiOkResponse({ type: MessageResponse })
  logout(@Body() dto: LogoutDto, @ClientContext() ctx: RequestContext): Promise<MessageResponse> {
    return this.auth.logout(dto, ctx);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke every session of the current user' })
  @ApiOkResponse({ type: MessageResponse })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @ClientContext() ctx: RequestContext,
  ): Promise<MessageResponse> {
    return this.auth.logoutAll(user, ctx);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get the current user and their profile' })
  @ApiOkResponse({ type: MeResponseDto })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponseDto> {
    return this.auth.me(user);
  }
}
