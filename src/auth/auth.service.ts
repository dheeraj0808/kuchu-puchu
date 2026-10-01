import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import type { Sequelize } from 'sequelize-typescript';

import { BanHashesService } from '../bans/ban-hashes.service';
import { OnboardingService } from '../common/onboarding/onboarding.service';
import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import type { RequestContext } from '../common/utils/request-context';
import { OutboxService } from '../events/outbox.service';
import { ProfilesService } from '../profiles/profiles.service';
import { SecurityEventType } from '../security/models/security-event.model';
import { SecurityEventsService } from '../security/security-events.service';
import { MeResponseDto } from '../users/dto/me.response';
import type { User } from '../users/models/user.model';
import { IdentifierUnavailableError, UsersService } from '../users/users.service';
import {
  LoginResponse,
  OtpRequestResponse,
  ReauthRequestResponse,
  ReauthVerifyResponse,
  SessionResponse,
  TokenPairResponse,
} from './dto/auth.responses';
import type { LogoutDto } from './dto/logout.dto';
import { MessageResponse } from './dto/message.response';
import type { OtpRequestDto } from './dto/otp-request.dto';
import type { OtpVerifyDto } from './dto/otp-verify.dto';
import type { ReauthRequestDto, ReauthVerifyDto } from './dto/reauth.dto';
import type { RefreshTokenDto } from './dto/refresh-token.dto';
import type { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { channelOf, IdentifierType, identifierTypeOf, OtpChannel, OtpPurpose } from './models/otp-verification.model';
import type { Session } from './models/session.model';
import { OtpDeliveryService } from './services/otp-delivery.service';
import { OtpService } from './services/otp.service';
import { REAUTH_WINDOW_MS, SessionRevokeReason, SessionService } from './services/session.service';
import { TokenService } from './services/token.service';
import { normalizeIdentifierStrict } from './utils/identifier.util';

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

export const OTP_REQUEST_MESSAGE = 'If the details are valid, a verification code has been sent.';

interface IssueRequest {
  type: IdentifierType;
  identifier: string;
  purpose: OtpPurpose;
  userId: string | null;
  /** Whether the identifier belongs to an account (its SMS comes from the reserved pool); asked after the caps pass. */
  existingAccount: () => Promise<boolean>;
  ctx: RequestContext;
}

type LoginOutcome =
  /** userId null: no account yet, but the identifier (canonical form) is in ban_hashes. */
  | { kind: 'restricted'; userId: string | null }
  | {
      kind: 'ok';
      user: User;
      session: Session;
      refreshToken: string;
      isNewUser: boolean;
      newDevice: boolean;
      replacedSessionIds: string[];
      evictedSessionIds: string[];
    };

/**
 * Passwordless sign-in, sessions, devices and step-up (guide M06). Identifiers
 * reach audit metadata only as hashIdentifier() prefixes; codes and tokens are
 * never logged or recorded.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly otp: OtpService,
    private readonly delivery: OtpDeliveryService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly users: UsersService,
    private readonly securityEvents: SecurityEventsService,
    private readonly outbox: OutboxService,
    private readonly onboarding: OnboardingService,
    private readonly profiles: ProfilesService,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly bans: BanHashesService,
  ) {}

  /**
   * Same 200 body for every identifier, known, unknown, banned or deleted:
   * the cooldown, caps and delivery never depend on the account. The one
   * lookup only picks the SMS budget pool (existing accounts use the reserve);
   * it runs once the caps have passed, for every identifier, and changes
   * nothing the client sees. A restricted user who enters the code is refused
   * at verify.
   */
  async requestOtp(dto: OtpRequestDto, ctx: RequestContext): Promise<OtpRequestResponse> {
    const type = identifierTypeOf(dto.channel);
    const identifier = normalizeIdentifierStrict(type, dto.identifier);
    const existingAccount = async (): Promise<boolean> => (await this.users.findByIdentifier(type, identifier)) !== null;
    await this.issueAndDeliver({ type, identifier, purpose: OtpPurpose.Login, userId: null, existingAccount, ctx });
    return this.otpRequestResponse();
  }

  async verifyOtp(dto: OtpVerifyDto, ctx: RequestContext): Promise<LoginResponse> {
    const type = identifierTypeOf(dto.channel);
    const identifier = normalizeIdentifierStrict(type, dto.identifier);
    const identifierHashPrefix = this.securityEvents.hashIdentifier(type, identifier);

    // Outside the login transaction, so used attempts persist whatever happens next.
    const result = await this.otp.verify({
      identifierHashes: [this.otp.hashIdentifier(type, identifier)],
      purpose: OtpPurpose.Login,
      channel: dto.channel,
      otp: dto.otp,
    });
    if (!result.ok) {
      await this.securityEvents.record({
        eventType: result.reason === 'attempts_exceeded' ? SecurityEventType.OtpAttemptsExceeded : SecurityEventType.OtpVerificationFailed,
        context: ctx,
        metadata: { identifierType: type, identifierHashPrefix, reason: result.reason, purpose: OtpPurpose.Login },
      });
      throw new AppException(ErrorCode.OtpInvalid);
    }
    await this.securityEvents.record({
      eventType: SecurityEventType.OtpVerified,
      context: ctx,
      metadata: { identifierType: type, identifierHashPrefix, purpose: OtpPurpose.Login },
    });

    const device = { deviceId: dto.deviceId, deviceName: dto.deviceName, platform: dto.platform, appVersion: dto.appVersion };
    let outcome: LoginOutcome;
    try {
      // A registration race whose winner rolls back can deadlock the waiters on the unique key; retried.
      outcome = await retryOnDeadlock(() =>
        this.sequelize.transaction(async (transaction): Promise<LoginOutcome> => {
          let user: User | null = null;
          let isNewUser = false;
          const found = await this.users.findByIdentifier(type, identifier, transaction);
          // The row lock serialises logins of one user, so one device never ends up with two live sessions.
          if (found) user = await this.users.findByIdForUpdate(found.id, transaction);
          if (!user) {
            // Ban evasion (M07): a new account for an identifier, or an alias of one, that a deleted banned account held.
            if (await this.bans.isIdentifierBanned(type, identifier, transaction)) return { kind: 'restricted', userId: null };
            const created = await this.users.createVerified(type, identifier, transaction);
            user = created.user;
            isNewUser = created.created;
          }
          if (!isNewUser) {
            if (!user.canAuthenticate()) return { kind: 'restricted', userId: user.id };
            const now = new Date();
            if (type === IdentifierType.Email && !user.emailVerifiedAt) user.emailVerifiedAt = now;
            if (type === IdentifierType.Phone && !user.phoneVerifiedAt) user.phoneVerifiedAt = now;
            user.lastLoginAt = now;
            await user.save({ transaction });
          }
          if (isNewUser) await this.outbox.publish('user.registered', user.id, { userId: user.id }, transaction);

          const created = await this.sessions.create(user.id, device, ctx, transaction);
          // A brand-new account has no "other" devices to warn about.
          const newDevice = created.newDevice && !isNewUser;
          if (newDevice) {
            await this.outbox.publish('auth.new_device', user.id, { userId: user.id, sessionId: created.session.id }, transaction);
          }
          return { kind: 'ok', user, isNewUser, ...created, newDevice };
        }),
      );
    } catch (err) {
      if (!(err instanceof IdentifierUnavailableError)) throw err;
      // A deleted account still holds the identifier: treated as not found, the same 401 as any verify failure.
      await this.securityEvents.record({
        eventType: SecurityEventType.OtpVerificationFailed,
        context: ctx,
        metadata: { identifierType: type, identifierHashPrefix, reason: 'identifier_unavailable', purpose: OtpPurpose.Login },
      });
      throw new AppException(ErrorCode.OtpInvalid);
    }

    if (outcome.kind === 'restricted') {
      await this.securityEvents.record({
        eventType: SecurityEventType.LoginBlocked,
        userId: outcome.userId,
        context: ctx,
        metadata: {
          identifierType: type,
          stage: 'verify_otp',
          ...(outcome.userId === null ? { reason: 'ban_hash', identifierHashPrefix } : {}),
        },
      });
      throw new AppException(ErrorCode.AccountRestricted);
    }

    const { user, session, isNewUser } = outcome;
    if (isNewUser) {
      await this.securityEvents.record({
        eventType: SecurityEventType.UserRegistered,
        userId: user.id,
        context: ctx,
        metadata: { identifierType: type },
      });
    }
    for (const replaced of outcome.replacedSessionIds) {
      // The stored reason is "replaced" either way; the cause tells a cap eviction from a same-device sign-in.
      const cause = outcome.evictedSessionIds.includes(replaced) ? 'session_cap' : 'same_device';
      await this.securityEvents.record({
        eventType: SecurityEventType.SessionRevoked,
        userId: user.id,
        context: ctx,
        metadata: { sessionId: replaced, reason: SessionRevokeReason.Replaced, cause, bySessionId: session.id },
      });
    }
    if (outcome.newDevice) {
      await this.securityEvents.record({
        eventType: SecurityEventType.NewDevice,
        userId: user.id,
        context: ctx,
        metadata: { sessionId: session.id, platform: session.platform },
      });
    }
    await this.securityEvents.record({
      eventType: SecurityEventType.LoginSucceeded,
      userId: user.id,
      context: ctx,
      metadata: { identifierType: type, sessionId: session.id, newUser: isNewUser },
    });

    const pair = await this.tokenPair(user.id, session.id, outcome.refreshToken);
    return {
      ...pair,
      user: this.users.toResponse(user),
      isNewUser,
      nextStep: await this.onboarding.nextStep(user.id),
    };
  }

  async refresh(dto: RefreshTokenDto, ctx: RequestContext): Promise<TokenPairResponse> {
    const { session, user, refreshToken } = await this.sessions.rotate(dto.refreshToken, ctx);
    const pair = await this.tokenPair(user.id, session.id, refreshToken);
    await this.securityEvents.record({
      eventType: SecurityEventType.TokenRefreshed,
      userId: user.id,
      context: ctx,
      metadata: { sessionId: session.id },
    });
    return pair;
  }

  /** Always 200, whether or not the token matched a session. */
  async logout(dto: LogoutDto, ctx: RequestContext): Promise<MessageResponse> {
    const revoked = await this.sessions.revokeByRefreshToken(dto.refreshToken);
    if (revoked) {
      await this.securityEvents.record({
        eventType: SecurityEventType.Logout,
        userId: revoked.userId,
        context: ctx,
        metadata: { sessionId: revoked.sessionId },
      });
    }
    return { message: 'Logged out' };
  }

  async logoutAll(principal: AuthenticatedUser, ctx: RequestContext): Promise<MessageResponse> {
    const count = await this.sessions.revokeAllForUser(principal.userId, SessionRevokeReason.LogoutAll);
    await this.securityEvents.record({
      eventType: SecurityEventType.LogoutAll,
      userId: principal.userId,
      context: ctx,
      metadata: { revokedSessions: count, sessionId: principal.sessionId },
    });
    return { message: 'Logged out from all devices' };
  }

  async me(principal: AuthenticatedUser): Promise<MeResponseDto> {
    const user = await this.users.findById(principal.userId);
    if (!user) throw new AppException(ErrorCode.Unauthorized);
    if (!user.canAuthenticate()) throw new AppException(ErrorCode.AccountRestricted);
    const [profile, nextStep] = await Promise.all([
      this.profiles.getOwnOrNull(user.id),
      this.onboarding.nextStep(user.id),
    ]);
    return MeResponseDto.fromUserAndProfile(user, profile, nextStep);
  }

  async listSessions(principal: AuthenticatedUser): Promise<SessionResponse[]> {
    const sessions = await this.sessions.listActive(principal.userId);
    return sessions.map((s) => SessionResponse.fromModel(s, principal.sessionId));
  }

  /** 404 unless it is one of the caller's live sessions (guide S1: never 403 for someone else's). */
  async revokeSession(principal: AuthenticatedUser, sessionId: string, ctx: RequestContext): Promise<MessageResponse> {
    if (!(await this.sessions.revokeOwn(principal.userId, sessionId))) throw new AppException(ErrorCode.NotFound);
    await this.securityEvents.record({
      eventType: SecurityEventType.SessionRevoked,
      userId: principal.userId,
      context: ctx,
      metadata: { sessionId, reason: SessionRevokeReason.Logout, bySessionId: principal.sessionId },
    });
    return { message: 'Session revoked' };
  }

  /** Step-up: a purpose=reauth code to the account's own verified phone (default) or email. */
  async reauthRequest(principal: AuthenticatedUser, dto: ReauthRequestDto, ctx: RequestContext): Promise<ReauthRequestResponse> {
    const user = await this.activeUser(principal);
    const target = this.reauthTarget(user, dto.channel);
    if (!target) {
      throw new AppException(ErrorCode.ValidationError, {
        errors: [{ field: 'channel', message: 'channel must be one of your verified sign-in methods' }],
      });
    }
    await this.issueAndDeliver({ ...target, purpose: OtpPurpose.Reauth, userId: user.id, existingAccount: async () => true, ctx });
    await this.securityEvents.record({
      eventType: SecurityEventType.ReauthRequested,
      userId: user.id,
      context: ctx,
      metadata: { sessionId: principal.sessionId, identifierType: target.type },
    });
    return { ...this.otpRequestResponse(), channel: channelOf(target.type) };
  }

  /** Sets reauthenticated_at on the current session; every failure is the same 401 OTP_INVALID. */
  async reauthVerify(principal: AuthenticatedUser, dto: ReauthVerifyDto, ctx: RequestContext): Promise<ReauthVerifyResponse> {
    const user = await this.activeUser(principal);
    const result = await this.otp.verify({
      identifierHashes: this.verifiedIdentifiers(user).map((t) => this.otp.hashIdentifier(t.type, t.identifier)),
      purpose: OtpPurpose.Reauth,
      otp: dto.otp,
    });
    if (!result.ok) {
      await this.securityEvents.record({
        eventType: SecurityEventType.ReauthFailed,
        userId: user.id,
        context: ctx,
        metadata: { sessionId: principal.sessionId, reason: result.reason },
      });
      throw new AppException(ErrorCode.OtpInvalid);
    }
    const at = new Date();
    if (!(await this.sessions.markReauthenticated(user.id, principal.sessionId, at))) {
      throw new AppException(ErrorCode.Unauthorized);
    }
    await this.securityEvents.record({
      eventType: SecurityEventType.ReauthSucceeded,
      userId: user.id,
      context: ctx,
      metadata: { sessionId: principal.sessionId, channel: result.record.channel },
    });
    return { reauthenticatedAt: at.toISOString(), validForSeconds: REAUTH_WINDOW_MS / 1000 };
  }

  /**
   * Cooldown and caps (429), then delivery. A delivery a fraud guard stops
   * (country, SMS pool, email budget) still answers like a sent one; only an
   * adapter failure is a 503.
   */
  private async issueAndDeliver(req: IssueRequest): Promise<void> {
    const { type, identifier, purpose, userId, existingAccount, ctx } = req;
    const metadata = {
      identifierType: type,
      identifierHashPrefix: this.securityEvents.hashIdentifier(type, identifier),
      purpose,
    };
    let issued;
    try {
      issued = await this.otp.issue({
        identifierHash: this.otp.hashIdentifier(type, identifier),
        rateLimitHash: this.otp.rateLimitHash(type, identifier),
        channel: channelOf(type),
        purpose,
        requestIp: ctx.ipAddress ?? '',
        deviceId: ctx.deviceId,
      });
    } catch (err) {
      if (err instanceof AppException && err.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
        await this.securityEvents.record({
          eventType: SecurityEventType.OtpRequestThrottled,
          userId,
          context: ctx,
          metadata: { ...metadata, code: err.code },
        });
      }
      throw err;
    }

    const isExisting = await existingAccount();
    let outcome;
    try {
      outcome = await this.delivery.send({ type, identifier, otp: issued.otp, purpose, existingAccount: isExisting });
    } catch {
      await issued.release();
      await this.securityEvents.record({ eventType: SecurityEventType.OtpDeliveryFailed, userId, context: ctx, metadata });
      throw new AppException(ErrorCode.OtpDeliveryFailed);
    }
    const eventType =
      outcome.status === 'country_blocked'
        ? SecurityEventType.OtpSmsCountryBlocked
        : outcome.status === 'budget_blocked'
          ? type === IdentifierType.Email
            ? SecurityEventType.OtpEmailBudgetBlocked
            : SecurityEventType.OtpSmsBudgetBlocked
          : SecurityEventType.OtpRequested;
    // Only a blocked send says which pool it was refused from; a sent one would reveal account existence to log readers.
    const pool = outcome.status === 'budget_blocked' && outcome.pool ? { budgetPool: outcome.pool } : {};
    await this.securityEvents.record({ eventType, userId, context: ctx, metadata: { ...metadata, ...pool } });
  }

  private async activeUser(principal: AuthenticatedUser): Promise<User> {
    const user = await this.users.findById(principal.userId);
    if (!user) throw new AppException(ErrorCode.Unauthorized);
    if (!user.canAuthenticate()) throw new AppException(ErrorCode.AccountRestricted);
    return user;
  }

  private verifiedIdentifiers(user: User): Array<{ type: IdentifierType; identifier: string }> {
    const out: Array<{ type: IdentifierType; identifier: string }> = [];
    if (user.phone && user.phoneVerifiedAt) out.push({ type: IdentifierType.Phone, identifier: user.phone });
    if (user.email && user.emailVerifiedAt) out.push({ type: IdentifierType.Email, identifier: user.email });
    return out;
  }

  /** The requested channel if verified; otherwise phone first, then email. */
  private reauthTarget(user: User, channel?: OtpChannel): { type: IdentifierType; identifier: string } | null {
    const verified = this.verifiedIdentifiers(user);
    if (!channel) return verified[0] ?? null;
    return verified.find((v) => v.type === identifierTypeOf(channel)) ?? null;
  }

  private otpRequestResponse(): OtpRequestResponse {
    return {
      message: OTP_REQUEST_MESSAGE,
      expiresInSeconds: this.otp.ttlSeconds,
      resendAfterSeconds: this.otp.resendCooldownSeconds,
    };
  }

  private async tokenPair(userId: string, sessionId: string, refreshToken: string): Promise<TokenPairResponse> {
    const access = await this.tokens.signAccessToken({ sub: userId, sid: sessionId });
    return { accessToken: access.token, refreshToken, expiresIn: access.expiresInSeconds };
  }
}
