import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';

import { AppException, ErrorCode } from '../exceptions/app.exception';

/** ThrottlerGuard that answers with the standard 429 body, including retryAfterSeconds. */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const retryAfterSeconds = Math.max(1, Math.ceil(detail.timeToBlockExpire));
    throw new AppException(ErrorCode.TooManyRequests, { retryAfterSeconds });
  }
}
