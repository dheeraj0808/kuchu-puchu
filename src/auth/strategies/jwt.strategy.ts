import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { JwtConfig } from '../../config/jwt.config';
import { UserRole } from '../../users/models/user.model';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';
import type { Request } from 'express';

import { extractRequestContext } from '../../common/decorators/client-context.decorator';
import { SecurityEventType } from '../../security/models/security-event.model';
import { SecurityEventsService } from '../../security/security-events.service';
import { AppException, ErrorCode } from '../../common/exceptions/app.exception';
import { SessionStateService, stateCanAuthenticate } from '../session-state/session-state.service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES: readonly string[] = Object.values(UserRole);

function isJwtPayload(value: unknown): value is JwtPayload {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.sub === 'string' &&
    UUID_REGEX.test(p.sub) &&
    typeof p.sid === 'string' &&
    UUID_REGEX.test(p.sid) &&
    typeof p.role === 'string' &&
    ROLES.includes(p.role)
  );
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly sessionState: SessionStateService,
    private readonly securityEvents: SecurityEventsService,
  ) {
    const jwt = config.getOrThrow<JwtConfig>('jwt');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwt.accessSecret,
      issuer: jwt.issuer,
      audience: jwt.audience,
      algorithms: ['HS256'],
      passReqToCallback: true,
    });
  }

  /**
   * Every request re-checks the session (cached 5 min, deleted on every
   * change) so revocation and restriction take effect on the next request.
   * Revoked, expired or unknown → 401; a user who can't authenticate → 403
   * ACCOUNT_RESTRICTED.
   */
  async validate(req: Request, payload: unknown): Promise<AuthenticatedUser> {
    if (!isJwtPayload(payload)) {
      throw new UnauthorizedException();
    }
    const state = await this.sessionState.get(payload.sid);
    if (!state || state.revoked || state.expiresAt <= Date.now() || state.userId !== payload.sub) {
      throw new UnauthorizedException();
    }
    if (!stateCanAuthenticate(state)) {
      if (await this.sessionState.takeRestrictionAuditSlot(payload.sid)) {
        await this.securityEvents.record({
          eventType: SecurityEventType.AccountRestricted,
          userId: state.userId,
          context: extractRequestContext(req),
          metadata: { sessionId: payload.sid, status: state.deleted ? 'deleted' : state.status },
        });
      }
      throw new AppException(ErrorCode.AccountRestricted);
    }
    // Role comes from the session state (DB), never from the token, so demotions apply at once.
    return { userId: state.userId, sessionId: payload.sid, role: state.role };
  }
}
