import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import { AppException, ErrorCode } from '../../common/exceptions/app.exception';
import { timingSafeEqualHex } from '../../common/utils/hmac';
import { ipBucket } from '../../common/utils/ip-bucket';
import type { ClientPlatform, RequestContext } from '../../common/utils/request-context';
import { OutboxService } from '../../events/outbox.service';
import { SecurityEventType } from '../../security/models/security-event.model';
import { SecurityEventsService } from '../../security/security-events.service';
import { User } from '../../users/models/user.model';
import { Session, SessionRevokeReason } from '../models/session.model';
import { SessionStateService } from '../session-state/session-state.service';
import { TokenService } from './token.service';

export { SessionRevokeReason } from '../models/session.model';

/** Guide M06: a step-up counts for 10 minutes. */
export const REAUTH_WINDOW_MS = 10 * 60_000;
/** Invalid-refresh security events: at most one per IP per this many seconds. */
export const INVALID_REFRESH_AUDIT_SECONDS = 300;

/** GET /auth/sessions returns at most this many devices, most recently used first. */
export const SESSION_LIST_LIMIT = 50;

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  platform: ClientPlatform;
  appVersion: string;
}

export interface CreatedSession {
  session: Session;
  refreshToken: string;
  /** No session of this user ever had this deviceId (as far as retained rows go). */
  newDevice: boolean;
  /** Live sessions this login replaced: the same device's, and the least recently used beyond the per-user cap. */
  replacedSessionIds: string[];
  /** The subset of replacedSessionIds revoked because of SESSION_MAX_PER_USER (not the same device). */
  evictedSessionIds: string[];
}

export interface RotatedSession {
  session: Session;
  user: User;
  refreshToken: string;
}

const USER_AGENT_MAX = 255;

/**
 * Sessions and refresh tokens (guide M06). A refresh token is
 * "<sessionId>.<secret>"; only HMAC(JWT_REFRESH_SECRET, secret) is stored.
 * Every refresh rotates it, and presenting the token it replaced (or losing a
 * rotation race) is treated as theft: every session of the user is revoked.
 * Every revoke drops the Redis session cache before the call returns.
 */
@Injectable()
export class SessionService {
  constructor(
    @InjectModel(Session) private readonly sessionModel: typeof Session,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly tokens: TokenService,
    private readonly securityEvents: SecurityEventsService,
    private readonly sessionState: SessionStateService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Opens a session inside the caller's login transaction (the caller holds
   * the user row lock, so two logins of one user never interleave). A live
   * session with the same deviceId is revoked as `replaced`; so are the least
   * recently used live sessions that would take the user past
   * SESSION_MAX_PER_USER.
   */
  async create(userId: string, device: DeviceInfo, ctx: RequestContext, transaction: Transaction): Promise<CreatedSession> {
    const now = new Date();
    const sameDevice = await this.sessionModel.findAll({
      attributes: ['id', 'revokedAt'],
      where: { userId, deviceId: device.deviceId },
      transaction,
    });
    const replacedSessionIds = sameDevice.filter((s) => !s.revokedAt).map((s) => s.id);
    const others = await this.sessionModel.findAll({
      attributes: ['id'],
      where: {
        userId,
        revokedAt: null,
        expiresAt: { [Op.gt]: now },
        absoluteExpiresAt: { [Op.gt]: now },
        ...(replacedSessionIds.length > 0 ? { id: { [Op.notIn]: replacedSessionIds } } : {}),
      },
      order: [
        ['lastUsedAt', 'ASC'],
        ['id', 'ASC'],
      ],
      transaction,
    });
    // Room for the new session: keep at most cap - 1 of the others, dropping the least recently used.
    const excess = others.length - (this.tokens.maxSessionsPerUser - 1);
    const evictedSessionIds = excess > 0 ? others.slice(0, excess).map((s) => s.id) : [];
    replacedSessionIds.push(...evictedSessionIds);
    if (replacedSessionIds.length > 0) {
      await this.sessionModel.update(
        { revokedAt: now, revokedReason: SessionRevokeReason.Replaced },
        { where: { id: { [Op.in]: replacedSessionIds }, revokedAt: null }, transaction },
      );
      await this.sessionState.invalidate(replacedSessionIds, transaction);
    }

    const secret = this.tokens.generateRefreshSecret();
    const absoluteExpiresAt = new Date(now.getTime() + this.tokens.maxLifetimeMs);
    const session = await this.sessionModel.create(
      {
        userId,
        refreshTokenHash: this.tokens.hashRefreshSecret(secret),
        previousTokenHash: null,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        platform: device.platform,
        appVersion: device.appVersion,
        ipAddress: ctx.ipAddress ?? '',
        userAgent: (ctx.userAgent ?? '').slice(0, USER_AGENT_MAX),
        lastUsedAt: now,
        expiresAt: this.slidingExpiry(now, absoluteExpiresAt),
        absoluteExpiresAt,
        reauthenticatedAt: null,
        revokedAt: null,
        revokedReason: null,
      },
      { transaction },
    );
    return {
      session,
      refreshToken: this.tokens.buildRefreshToken(session.id, secret),
      newDevice: sameDevice.length === 0,
      replacedSessionIds,
      evictedSessionIds,
    };
  }

  /**
   * Rotates a refresh token. 401 UNAUTHORIZED for anything that is not the
   * session's current token. The previous token, or the loser of two parallel
   * refreshes of one token, revokes every session of the user
   * (reuse_detected), publishes auth.token_reuse and records a security event.
   */
  async rotate(refreshToken: string, ctx: RequestContext): Promise<RotatedSession> {
    const parsed = this.tokens.parseRefreshToken(refreshToken);
    if (!parsed) {
      await this.recordInvalid(null, ctx, 'malformed');
      throw unauthorized();
    }

    const now = new Date();
    const session = await this.sessionModel.findByPk(parsed.sessionId, { include: [{ model: User, required: false }] });
    if (!session) {
      await this.recordInvalid(null, ctx, 'unknown_session');
      throw unauthorized();
    }
    if (session.revokedAt || !session.isUsable(now)) {
      await this.recordInvalid(session.userId, ctx, session.revokedAt ? 'revoked_session' : 'expired_session');
      throw unauthorized();
    }

    const presented = this.tokens.hashRefreshSecret(parsed.secret);
    const matchesCurrent = timingSafeEqualHex(presented, session.refreshTokenHash);
    const matchesPrevious = session.previousTokenHash !== null && timingSafeEqualHex(presented, session.previousTokenHash);
    if (!matchesCurrent) {
      if (matchesPrevious) await this.handleReuse(session, ctx, 'previous_token');
      else await this.recordInvalid(session.userId, ctx, 'hash_mismatch');
      throw unauthorized();
    }

    const user = session.user;
    if (!user || !user.canAuthenticate()) {
      await this.revokeSession(session.id, SessionRevokeReason.Restricted);
      await this.securityEvents.record({
        eventType: SecurityEventType.SessionRevoked,
        userId: session.userId,
        context: ctx,
        metadata: { sessionId: session.id, reason: SessionRevokeReason.Restricted, stage: 'refresh' },
      });
      throw new AppException(ErrorCode.AccountRestricted);
    }

    const newSecret = this.tokens.generateRefreshSecret();
    const changes = {
      previousTokenHash: session.refreshTokenHash,
      refreshTokenHash: this.tokens.hashRefreshSecret(newSecret),
      lastUsedAt: now,
      ipAddress: ctx.ipAddress ?? session.ipAddress,
      userAgent: ctx.userAgent ? ctx.userAgent.slice(0, USER_AGENT_MAX) : session.userAgent,
      ...(ctx.appVersion ? { appVersion: ctx.appVersion } : {}),
      expiresAt: this.slidingExpiry(now, session.absoluteExpiresAt),
    };
    const [affected] = await this.sessionModel.update(changes, {
      where: { id: session.id, refreshTokenHash: session.refreshTokenHash, revokedAt: null },
    });
    if (affected === 0) {
      // Lost the race: the token was rotated (or the session revoked) after it was read.
      const fresh = await this.sessionModel.findByPk(session.id, { attributes: ['id', 'userId', 'revokedAt'] });
      if (fresh && !fresh.revokedAt) await this.handleReuse(session, ctx, 'concurrent_refresh');
      else await this.recordInvalid(session.userId, ctx, 'revoked_session');
      throw unauthorized();
    }
    session.set(changes);
    // The cached state holds the old expiry; drop it so the slide is seen at once.
    await this.sessionState.invalidate([session.id]);
    return { session, user, refreshToken: this.tokens.buildRefreshToken(session.id, newSecret) };
  }

  /** Revokes the session whose current token this is. Returns its user id, or null (unknown, revoked, not current). */
  async revokeByRefreshToken(refreshToken: string): Promise<{ userId: string; sessionId: string } | null> {
    const parsed = this.tokens.parseRefreshToken(refreshToken);
    if (!parsed) return null;
    const session = await this.sessionModel.findByPk(parsed.sessionId);
    if (!session || session.revokedAt) return null;
    const presented = this.tokens.hashRefreshSecret(parsed.secret);
    if (!timingSafeEqualHex(presented, session.refreshTokenHash)) return null;
    const [affected] = await this.sessionModel.update(
      { revokedAt: new Date(), revokedReason: SessionRevokeReason.Logout },
      { where: { id: session.id, refreshTokenHash: presented, revokedAt: null } },
    );
    if (affected === 0) return null;
    await this.sessionState.invalidate([session.id]);
    return { userId: session.userId, sessionId: session.id };
  }

  /** Every open session of the user, the current one included. Cache dropped (after commit with a transaction). */
  async revokeAllForUser(userId: string, reason: SessionRevokeReason, transaction?: Transaction): Promise<number> {
    const [affected] = await this.sessionModel.update(
      { revokedAt: new Date(), revokedReason: reason },
      { where: { userId, revokedAt: null }, transaction },
    );
    await this.sessionState.invalidateUser(userId, transaction);
    return affected;
  }

  /** DELETE /auth/sessions/:id. False unless it is one of the caller's live sessions (the caller answers 404). */
  async revokeOwn(userId: string, sessionId: string): Promise<boolean> {
    const now = new Date();
    const [affected] = await this.sessionModel.update(
      { revokedAt: now, revokedReason: SessionRevokeReason.Logout },
      {
        where: {
          id: sessionId,
          userId,
          revokedAt: null,
          expiresAt: { [Op.gt]: now },
          absoluteExpiresAt: { [Op.gt]: now },
        },
      },
    );
    if (affected === 0) return false;
    await this.sessionState.invalidate([sessionId]);
    return true;
  }

  async revokeSession(sessionId: string, reason: SessionRevokeReason): Promise<boolean> {
    const [affected] = await this.sessionModel.update(
      { revokedAt: new Date(), revokedReason: reason },
      { where: { id: sessionId, revokedAt: null } },
    );
    await this.sessionState.invalidate([sessionId]);
    return affected > 0;
  }

  /** The caller's live sessions, most recently used first. */
  listActive(userId: string): Promise<Session[]> {
    const now = new Date();
    return this.sessionModel.findAll({
      where: { userId, revokedAt: null, expiresAt: { [Op.gt]: now }, absoluteExpiresAt: { [Op.gt]: now } },
      order: [['lastUsedAt', 'DESC']],
      limit: SESSION_LIST_LIMIT,
    });
  }

  /** Step-up passed on this session. False if the session is no longer open. */
  async markReauthenticated(userId: string, sessionId: string, at: Date): Promise<boolean> {
    const [affected] = await this.sessionModel.update(
      { reauthenticatedAt: at },
      { where: { id: sessionId, userId, revokedAt: null } },
    );
    return affected > 0;
  }

  /** Read from MySQL, never the cache: a step-up must be visible at once. */
  async hasFreshReauth(userId: string, sessionId: string, now: Date = new Date()): Promise<boolean> {
    const session = await this.sessionModel.findOne({
      attributes: ['reauthenticatedAt'],
      where: { id: sessionId, userId, revokedAt: null },
    });
    const at = session?.reauthenticatedAt;
    return !!at && now.getTime() - at.getTime() <= REAUTH_WINDOW_MS && at.getTime() <= now.getTime();
  }

  private slidingExpiry(now: Date, absoluteExpiresAt: Date): Date {
    return new Date(Math.min(now.getTime() + this.tokens.slidingMs, absoluteExpiresAt.getTime()));
  }

  /** Theft response: revoke everything, publish auth.token_reuse, audit. One transaction. */
  private async handleReuse(session: Session, ctx: RequestContext, trigger: string): Promise<void> {
    const userId = session.userId;
    await this.sequelize.transaction(async (transaction) => {
      const revoked = await this.revokeAllForUser(userId, SessionRevokeReason.ReuseDetected, transaction);
      // A second replay after everything is already revoked publishes nothing new.
      if (revoked > 0) await this.outbox.publish('auth.token_reuse', userId, { userId, sessionId: session.id }, transaction);
      await this.securityEvents.record({
        eventType: SecurityEventType.RefreshTokenReuseDetected,
        userId,
        context: ctx,
        metadata: { sessionId: session.id, trigger, revokedSessions: revoked },
        transaction,
      });
    });
  }

  /**
   * Tokens that name no real session (malformed, unknown session id) are
   * audited at most once per IP (an IPv6 /64 counts as one) per
   * INVALID_REFRESH_AUDIT_SECONDS, so spraying garbage cannot flood the log.
   * A failure against a real session (it carries a userId) is always recorded.
   */
  private async recordInvalid(userId: string | null, ctx: RequestContext, reason: string): Promise<void> {
    if (userId === null && !(await this.sessionState.takeAuditSlot('refresh-invalid-audit', ipBucket(ctx.ipAddress), INVALID_REFRESH_AUDIT_SECONDS))) {
      return;
    }
    await this.securityEvents.record({
      eventType: SecurityEventType.RefreshTokenInvalid,
      userId,
      context: ctx,
      metadata: { reason },
    });
  }
}

function unauthorized(): AppException {
  return new AppException(ErrorCode.Unauthorized);
}
