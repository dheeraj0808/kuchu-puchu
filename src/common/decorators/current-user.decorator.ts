import { createParamDecorator, type ExecutionContext, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { AppException, ErrorCode } from '../exceptions/app.exception';

/** Injects the authenticated principal set by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (!req.user) {
      throw new AppException(ErrorCode.Unauthorized, 'Authentication required', HttpStatus.UNAUTHORIZED);
    }
    return req.user;
  },
);
