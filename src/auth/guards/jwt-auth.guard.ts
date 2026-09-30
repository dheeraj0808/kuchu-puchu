import { HttpStatus, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { AppException, ErrorCode } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  // Generic failure — never reveal whether the token was expired, revoked, forged, etc.
  override handleRequest<TUser = AuthenticatedUser>(err: unknown, user: unknown): TUser {
    if (err || !user) {
      throw new AppException(ErrorCode.Unauthorized, 'Authentication required', HttpStatus.UNAUTHORIZED);
    }
    return user as TUser;
  }
}
