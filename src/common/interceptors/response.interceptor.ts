import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

import { Paginated } from '../pagination/paginated';

/** Success body from guide §4.1. `meta` is only present for lists. */
export interface SuccessResponse<T> {
  success: true;
  data: T;
  meta?: { nextCursor: string | null };
}

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, SuccessResponse<unknown>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<SuccessResponse<unknown>> {
    return next.handle().pipe(
      map((data) => {
        if (data instanceof Paginated) {
          return {
            success: true as const,
            data: data.items as unknown,
            meta: { nextCursor: data.nextCursor },
          };
        }
        return { success: true as const, data };
      }),
    );
  }
}
