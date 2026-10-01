import { ProfilesService } from '../profiles/profiles.service';
import { MeResponseDto } from '../users/dto/me.response';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import type { Sequelize } from 'sequelize-typescript';

import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import type { RequestContext } from '../common/utils/request-context';
import { SecurityEventType } from '../security/models/security-event.model';
import { SecurityEventsService } from '../security/security-events.service';
import type { User } from '../users/models/user.model';
import { IdentifierUnavailableError, UsersService } from '../users/users.service';
import { AuthTokensResponse } from './dto/auth-tokens.response';
import type { LogoutDto } from './dto/logout.dto';
import { MessageResponse } from './dto/message.response';
import type { RefreshTokenDto } from './dto/refresh-token.dto';
import type { RequestOtpDto } from './dto/request-otp.dto';
import { RequestOtpResponse } from './dto/request-otp.response';
import type { VerifyOtpDto } from './dto/verify-otp.dto';
import type { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { IdentifierType } from './models/otp-verification.model';
import type { Session } from './models/session.model';
import { OtpDeliveryService } from './services/otp-delivery.service';
import { type IssuedOtp, OtpService } from './services/otp.service';
import {
  SessionRevokeReason,
  SessionService,
} from './services/session.service';
import { TokenService } from './services/token.service';
import { normalizeIdentifier } from './utils/identifier.util';

const ER_LOCK_DEADLOCK = 1213;

async function retryOnDeadlock<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      const errno = (err as { parent?: { errno?: number } }).parent?.errno;
      if (errno !== ER_LOCK_DEADLOCK || attempt >= attempts) throw err;
    }
  }
}

export const OTP_REQUEST_MESSAGE =
  'If the details are valid, a verification code has been sent.';

@Injectable()
export class AuthService {
  constructor(
    private readonly otp: OtpService,
    private readonly delivery: OtpDeliveryService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly users: UsersService,
    private readonly securityEvents: SecurityEventsService,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly profiles: ProfilesService,
  ) {}

  async requestOtp(
    dto: RequestOtpDto,
    ctx: RequestContext,
  ): Promise<RequestOtpResponse> {
    const type = dto.identifierType;
    const identifier = normalizeIdentifier(type, dto.identifier);
    const identifierHashPrefix = this.securityEvents.hashIdentifier(type, identifier);
    const metadata = { identifierType: type, identifierHashPrefix };
    const response = this.otpRequestResponse();

    const user = await this.users.findByIdentifier(type, identifier);
    if (user && !user.canAuthenticate()) {
      // Respond identically so account state is not disclosed; send nothing.
      await this.securityEvents.record({
        eventType: SecurityEventType.LoginBlocked,
        userId: user.id,
        context: ctx,
        metadata: { ...metadata, stage: 'request_otp' },
      });
      return response;
    }

    let issued: IssuedOtp;
    try {
      issued = await this.otp.issue(type, identifier, user?.id ?? null, ctx);
    } catch (err) {
      if (
        err instanceof AppException &&
        err.getStatus() === HttpStatus.TOO_MANY_REQUESTS
      ) {
        await this.securityEvents.record({
          eventType: SecurityEventType.OtpRequestThrottled,
          userId: user?.id ?? null,
          context: ctx,
          metadata: { ...metadata, code: err.code },
        });
      }
      throw err;
    }

    try {
      await this.delivery.send(type, identifier, issued.otp);
    } catch {
      await this.securityEvents.record({
        eventType: SecurityEventType.OtpDeliveryFailed,
        userId: user?.id ?? null,
        context: ctx,
        metadata,
      });
      throw new AppException(ErrorCode.OtpDeliveryFailed);
    }

    await this.securityEvents.record({
      eventType: SecurityEventType.OtpRequested,
      userId: user?.id ?? null,
      context: ctx,
      metadata,
    });
    return response;
  }

  async verifyOtp(
    dto: VerifyOtpDto,
    ctx: RequestContext,
  ): Promise<AuthTokensResponse> {
    const type = dto.identifierType;
    const identifier = normalizeIdentifier(type, dto.identifier);
    const identifierHashPrefix = this.securityEvents.hashIdentifier(type, identifier);

    // Outside the login transaction so attempt counters always persist.
    const result = await this.otp.verify(type, identifier, dto.otp);
    if (!result.ok) {
      await this.securityEvents.record({
        eventType:
          result.reason === 'attempts_exceeded'
            ? SecurityEventType.OtpAttemptsExceeded
            : SecurityEventType.OtpVerificationFailed,
        context: ctx,
        metadata: {
          identifierType: type,
          identifierHashPrefix,
          reason: result.reason,
        },
      });
      throw new AppException(ErrorCode.OtpInvalid);
    }

    const otpRecordId = result.record.id;
    let registered = false;
    let blockedUserId: string | null = null;

    // A registration race whose winner rolls back can deadlock the waiters on the unique key;
    // MySQL then rolls the whole transaction back, so it is retried (up to 3 attempts).
    const outcome = await retryOnDeadlock(() =>
      this.sequelize.transaction(async (transaction) => {
        // Reset per attempt: a deadlocked first attempt must not leak its outcome.
        registered = false;
        blockedUserId = null;
        let user = await this.users.findByIdentifier(
          type,
          identifier,
          transaction,
        );
        if (!user) {
          // createVerified returns the existing user if a concurrent request won the insert.
          const result = await this.users.createVerified(
            type,
            identifier,
            transaction,
          );
          user = result.user;
          registered = result.created;
        }

        if (!registered) {
          if (!user.canAuthenticate()) {
            blockedUserId = user.id;
            return null;
          }
          const now = new Date();
          if (type === IdentifierType.Email && !user.emailVerifiedAt)
            user.emailVerifiedAt = now;
          if (type === IdentifierType.Phone && !user.phoneVerifiedAt)
            user.phoneVerifiedAt = now;
          user.lastLoginAt = now;
          await user.save({ transaction });
        }

        await this.otp.linkUser(otpRecordId, user.id, transaction);
        const created = await this.sessions.create(
          user.id,
          {
            deviceId: dto.deviceId ?? null,
            deviceName: dto.deviceName ?? null,
          },
          ctx,
          transaction,
        );
        return { user, ...created };
      }),
    ).catch(async (err: unknown) => {
      if (!(err instanceof IdentifierUnavailableError)) throw err;
      // A deleted account still holds the identifier: treated as not found, the same 401 as any verify failure.
      await this.securityEvents.record({
        eventType: SecurityEventType.OtpVerificationFailed,
        context: ctx,
        metadata: { identifierType: type, identifierHashPrefix, reason: 'identifier_unavailable' },
      });
      throw new AppException(ErrorCode.OtpInvalid);
    });

    if (!outcome) {
      await this.securityEvents.record({
        eventType: SecurityEventType.LoginBlocked,
        userId: blockedUserId,
        context: ctx,
        metadata: { identifierType: type, stage: 'verify_otp' },
      });
      throw new AppException(ErrorCode.AccountRestricted);
    }

    const { user, session, refreshToken } = outcome;
    if (registered) {
      await this.securityEvents.record({
        eventType: SecurityEventType.UserRegistered,
        userId: user.id,
        context: ctx,
        metadata: { identifierType: type },
      });
    }
    const tokens = await this.buildTokens(user, session, refreshToken);
    await this.securityEvents.record({
      eventType: SecurityEventType.LoginSucceeded,
      userId: user.id,
      context: ctx,
      metadata: {
        identifierType: type,
        sessionId: session.id,
        newUser: registered,
      },
    });
    return tokens;
  }

  async refresh(
    dto: RefreshTokenDto,
    ctx: RequestContext,
  ): Promise<AuthTokensResponse> {
    const { session, user, refreshToken } = await this.sessions.rotate(
      dto.refreshToken,
      ctx,
    );
    const tokens = await this.buildTokens(user, session, refreshToken);
    await this.securityEvents.record({
      eventType: SecurityEventType.TokenRefreshed,
      userId: user.id,
      context: ctx,
      metadata: { sessionId: session.id },
    });
    return tokens;
  }

  async logout(dto: LogoutDto, ctx: RequestContext): Promise<MessageResponse> {
    const userId = await this.sessions.revokeByRefreshToken(
      dto.refreshToken,
      ctx,
    );
    if (userId) {
      await this.securityEvents.record({
        eventType: SecurityEventType.Logout,
        userId,
        context: ctx,
      });
    }
    return { message: 'Logged out' };
  }

  async logoutAll(
    principal: AuthenticatedUser,
    ctx: RequestContext,
  ): Promise<MessageResponse> {
    const count = await this.sessions.revokeAllForUser(
      principal.userId,
      SessionRevokeReason.LogoutAll,
    );
    await this.securityEvents.record({
      eventType: SecurityEventType.LogoutAll,
      userId: principal.userId,
      context: ctx,
      metadata: { revokedSessions: count },
    });
    return { message: 'Logged out from all devices' };
  }

  async me(principal: AuthenticatedUser): Promise<MeResponseDto> {
    const user = await this.users.findById(principal.userId);
    if (!user) throw new AppException(ErrorCode.Unauthorized);
    if (!user.canAuthenticate())
      throw new AppException(ErrorCode.AccountRestricted);
    const profile = await this.profiles.getOwnOrNull(user.id);
    return MeResponseDto.fromUserAndProfile(user, profile);
  }

  private otpRequestResponse(): RequestOtpResponse {
    return {
      message: OTP_REQUEST_MESSAGE,
      expiresInSeconds: this.otp.ttlSeconds,
      resendAfterSeconds: this.otp.resendCooldownSeconds,
    };
  }

  private async buildTokens(
    user: User,
    session: Session,
    refreshToken: string,
  ): Promise<AuthTokensResponse> {
    const access = await this.tokens.signAccessToken({
      sub: user.id,
      sid: session.id,
      role: user.role,
    });
    return {
      accessToken: access.token,
      refreshToken,
      tokenType: 'Bearer',
      accessTokenExpiresIn: access.expiresInSeconds,
      refreshTokenExpiresAt: session.expiresAt.toISOString(),
      user: this.users.toResponse(user),
    };
  }
}
