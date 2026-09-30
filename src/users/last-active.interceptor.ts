import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { UsersService } from './users.service';

/** /health and /health/ready: never counted as activity. */
const EXCLUDED = /^\/api\/v\d+\/health(\/|$)/;

/**
 * Global (guide M04): records activity for authenticated requests. Runs after
 * the guards, so req.user is set only when JwtAuthGuard accepted the request.
 * Fire-and-forget: the response never waits and never fails because of it.
 */
@Injectable()
export class LastActiveInterceptor implements NestInterceptor {
  constructor(private readonly users: UsersService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
      const userId = req.user?.userId;
      if (userId && !EXCLUDED.test(req.path ?? req.url)) {
        void this.users.touchLastActive(userId);
      }
    }
    return next.handle();
  }
}
