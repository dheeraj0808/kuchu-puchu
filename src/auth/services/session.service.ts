import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type Transaction } from 'sequelize';

import { AppException, ErrorCode } from '../../common/exceptions/app.exception';
import type { RequestContext } from '../../common/utils/request-context';
import { SecurityEventType } from '../../security/models/security-event.model';
import { SecurityEventsService } from '../../security/security-events.service';
import { User } from '../../users/models/user.model';
import { Session } from '../models/session.model';
import { timingSafeEqualHex } from '../utils/crypto.util';
import { TokenService } from './token.service';

export interface DeviceInfo {
  deviceId?: string | null;
  deviceName?: string | null;
}

export interface CreatedSession {
  session: Session;
  refreshToken: string;
}

export interface RotatedSession {
  session: Session;
  user: User;
  refreshToken: string;
}

export enum SessionRevokeReason {
  Logout = 'logout',
  LogoutAll = 'logout_all',
  ReplacedByNewLogin = 'replaced_by_new_login',
  RefreshTokenReuse = 'refresh_token_reuse',
  AccountRestricted = 'account_restricted',
  AccountDeleted = 'account_deleted',
}

@Injectable()
export class SessionService {
  constructor(
    @InjectModel(Session) private readonly sessionModel: typeof Session,
    private readonly tokens: TokenService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  private now(): Date {
    return new Date();
  }

  async create(
    userId: string,
    device: DeviceInfo,
    ctx: RequestContext,
    transaction?: Transaction,
  ): Promise<CreatedSession> {
    const now = this.now();
    const deviceId = device.deviceId ?? null;
    if (deviceId) {
      await this.sessionModel.update(
        { revokedAt: now, revokedReason: SessionRevokeReason.ReplacedByNewLogin },
        { where: { userId, deviceId, revokedAt: null }, transaction },
      );
    }

    const id = randomUUID();
    const secret = this.tokens.generateRefreshSecret();
    const session = await this.sessionModel.create(
      {
        id,
        userId,
        refreshTokenHash: this.tokens.hashRefreshSecret(secret),
        previousRefreshTokenHash: null,
        deviceId,
        deviceName: device.deviceName ?? null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        lastUsedAt: now,
        expiresAt: new Date(now.getTime() + this.tokens.refreshTtlSeconds * 1000),
        revokedAt: null,
        revokedReason: null,
      },
      { transaction },
    );
    return { session, refreshToken: this.tokens.buildRefreshToken(id, secret) };
  }

  async rotate(refreshToken: string, ctx: RequestContext): Promise<RotatedSession> {
    const parsed = this.tokens.parseRefreshToken(refreshToken);
    if (!parsed) {
      await this.recordInvalid(null, ctx, 'malformed');
      throw this.invalidRefreshToken();
    }

    const now = this.now();
    const session = await this.sessionModel.findByPk(parsed.sessionId, {
      include: [{ model: User, required: false }],
    });
    if (!session || !session.isUsable(now)) {
      await this.recordInvalid(session?.userId ?? null, ctx, session ? 'inactive_session' : 'unknown_session');
      throw this.invalidRefreshToken();
    }

    const presentedHash = this.tokens.hashRefreshSecret(parsed.secret);
    const matchesCurrent = timingSafeEqualHex(presentedHash, session.refreshTokenHash);
    const matchesPrevious =
      session.previousRefreshTokenHash !== null &&
      timingSafeEqualHex(presentedHash, session.previousRefreshTokenHash);

    if (!matchesCurrent) {
      if (matchesPrevious) {
        // A rotated-out token was replayed: assume theft, kill the session.
        await this.revokeSession(session.id, SessionRevokeReason.RefreshTokenReuse);
        await this.securityEvents.record({
          eventType: SecurityEventType.RefreshTokenReuseDetected,
          userId: session.userId,
          context: ctx,
          metadata: { sessionId: session.id },
        });
      } else {
        await this.recordInvalid(session.userId, ctx, 'hash_mismatch');
      }
      throw this.invalidRefreshToken();
    }

    const user = session.user;
    if (!user || !user.canAuthenticate()) {
      await this.revokeSession(session.id, SessionRevokeReason.AccountRestricted);
      await this.securityEvents.record({
        eventType: SecurityEventType.LoginBlocked,
        userId: session.userId,
        context: ctx,
        metadata: { sessionId: session.id, stage: 'refresh' },
      });
      throw new AppException(ErrorCode.AccountRestricted);
    }

    const newSecret = this.tokens.generateRefreshSecret();
    const newHash = this.tokens.hashRefreshSecret(newSecret);
    const expiresAt = new Date(now.getTime() + this.tokens.refreshTtlSeconds * 1000);
    const changes = {
      previousRefreshTokenHash: session.refreshTokenHash,
      refreshTokenHash: newHash,
      lastUsedAt: now,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      expiresAt,
    };
    const [affected] = await this.sessionModel.update(changes, {
      where: { id: session.id, refreshTokenHash: session.refreshTokenHash, revokedAt: null },
    });
    if (affected === 0) {
      // Concurrent rotation won the race; this token is now stale.
      await this.recordInvalid(session.userId, ctx, 'concurrent_rotation');
      throw this.invalidRefreshToken();
    }

    session.set(changes);
    return {
      session,
      user,
      refreshToken: this.tokens.buildRefreshToken(session.id, newSecret),
    };
  }

  /**
   * Idempotent. Revokes only when the presented token is the session's
   * current one, so knowing a session id alone is not enough.
   * Returns the owning userId when a session was revoked.
   */
  async revokeByRefreshToken(refreshToken: string, _ctx: RequestContext): Promise<string | null> {
    const parsed = this.tokens.parseRefreshToken(refreshToken);
    if (!parsed) return null;
    const session = await this.sessionModel.findByPk(parsed.sessionId);
    if (!session || session.revokedAt) return null;

    const presentedHash = this.tokens.hashRefreshSecret(parsed.secret);
    if (!timingSafeEqualHex(presentedHash, session.refreshTokenHash)) return null;

    const [affected] = await this.sessionModel.update(
      { revokedAt: this.now(), revokedReason: SessionRevokeReason.Logout },
      { where: { id: session.id, refreshTokenHash: presentedHash, revokedAt: null } },
    );
    return affected > 0 ? session.userId : null;
  }

  async revokeAllForUser(
    userId: string,
    reason: SessionRevokeReason | string,
    transaction?: Transaction,
  ): Promise<number> {
    const [affected] = await this.sessionModel.update(
      { revokedAt: this.now(), revokedReason: reason },
      { where: { userId, revokedAt: null }, transaction },
    );
    return affected;
  }

  async revokeSession(sessionId: string, reason: SessionRevokeReason | string): Promise<boolean> {
    const [affected] = await this.sessionModel.update(
      { revokedAt: this.now(), revokedReason: reason },
      { where: { id: sessionId, revokedAt: null } },
    );
    return affected > 0;
  }

  async findActiveSession(sessionId: string): Promise<Session | null> {
    return this.sessionModel.findOne({
      where: { id: sessionId, revokedAt: null, expiresAt: { [Op.gt]: this.now() } },
      include: [{ model: User, required: false }],
    });
  }

  private async recordInvalid(userId: string | null, ctx: RequestContext, reason: string): Promise<void> {
    await this.securityEvents.record({
      eventType: SecurityEventType.RefreshTokenInvalid,
      userId,
      context: ctx,
      metadata: { reason },
    });
  }

  private invalidRefreshToken(): AppException {
    return new AppException(ErrorCode.InvalidRefreshToken);
  }
}
