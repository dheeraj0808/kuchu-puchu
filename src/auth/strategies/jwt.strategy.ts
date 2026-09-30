import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { JwtConfig } from '../../config/jwt.config';
import { UserRole } from '../../users/models/user.model';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';
import { SessionService } from '../services/session.service';

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
    private readonly sessions: SessionService,
  ) {
    const jwt = config.getOrThrow<JwtConfig>('jwt');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwt.accessSecret,
      issuer: jwt.issuer,
      audience: jwt.audience,
      algorithms: ['HS256'],
    });
  }

  /** Every request re-checks the session so revocation takes effect immediately. */
  async validate(payload: unknown): Promise<AuthenticatedUser> {
    if (!isJwtPayload(payload)) {
      throw new UnauthorizedException();
    }
    const session = await this.sessions.findActiveSession(payload.sid);
    if (!session || session.userId !== payload.sub) {
      throw new UnauthorizedException();
    }
    const user = session.user;
    if (!user || user.id !== payload.sub || !user.canAuthenticate()) {
      throw new UnauthorizedException();
    }
    // Role is taken from the DB, not the token, so demotions apply immediately.
    return { userId: user.id, sessionId: session.id, role: user.role };
  }
}
