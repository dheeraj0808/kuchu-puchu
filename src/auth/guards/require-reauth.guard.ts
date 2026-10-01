import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { AppException, ErrorCode } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { SessionService } from '../services/session.service';

/**
 * Step-up for dangerous actions (guide M06): 403 REAUTH_REQUIRED unless the
 * current session passed POST /auth/reauth/verify within the last 10 minutes.
 * Runs after JwtAuthGuard: `@UseGuards(JwtAuthGuard, RequireReauthGuard)`.
 */
@Injectable()
export class RequireReauthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>().user;
    if (!user) throw new AppException(ErrorCode.Unauthorized);
    if (!(await this.sessions.hasFreshReauth(user.userId, user.sessionId))) {
      throw new AppException(ErrorCode.ReauthRequired);
    }
    return true;
  }
}
