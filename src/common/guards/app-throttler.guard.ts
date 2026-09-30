import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerRequest,
  ThrottlerStorage,
} from '@nestjs/throttler';
import type { Request } from 'express';

import type { JwtConfig } from '../../config/jwt.config';
import { redisKey } from '../../infra/redis/redis-keys';
import { AppException, ErrorCode } from '../exceptions/app.exception';
import { THROTTLER_IP, THROTTLER_USER } from '../throttling/throttling.constants';

const THROTTLER_LIMIT_METADATA = 'THROTTLER:LIMIT';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cached per request: the verified user id from the bearer token, or null. */
const userIds = new WeakMap<object, string | null>();

/**
 * Two throttlers run on every request (guide M01, S4):
 * - `default`: per client IP.
 * - `user`: per user id, only for requests with a valid access token.
 *
 * Counters are global per tracker (all routes share one budget) unless a route
 * sets its own @Throttle() limit, which then gets a separate per-route counter.
 * Answers with the standard 429 body, including retryAfterSeconds.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly jwt: JwtService;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    config: ConfigService,
  ) {
    super(options, storageService, reflector);
    const jwt = config.getOrThrow<JwtConfig>('jwt');
    this.jwt = new JwtService({
      secret: jwt.accessSecret,
      verifyOptions: { issuer: jwt.issuer, audience: jwt.audience, algorithms: ['HS256'] },
    });
  }

  protected override async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    if (props.throttler.name !== THROTTLER_USER) return super.handleRequest(props);
    const userId = this.userIdOf(this.getRequestResponse(props.context).req as Request);
    if (!userId) return true; // anonymous: only the IP throttler applies
    return super.handleRequest({ ...props, getTracker: () => Promise.resolve(userId) });
  }

  protected override generateKey(context: ExecutionContext, tracker: string, name: string): string {
    const hasRouteLimit =
      this.reflector.getAllAndOverride<number | undefined>(THROTTLER_LIMIT_METADATA + name, [
        context.getHandler(),
        context.getClass(),
      ]) !== undefined;
    const scope = hasRouteLimit ? `${context.getClass().name}.${context.getHandler().name}` : 'global';
    return redisKey('throttle', name === THROTTLER_IP ? 'ip' : name, scope, tracker);
  }

  protected override throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const retryAfterSeconds = Math.max(1, Math.ceil(detail.timeToBlockExpire));
    throw new AppException(ErrorCode.TooManyRequests, { retryAfterSeconds });
  }

  /**
   * Verifies the bearer token's signature, expiry, issuer and audience only.
   * JwtAuthGuard still does the full session check later; this just picks
   * whose budget to count, and a forged token cannot choose someone else's.
   */
  private userIdOf(req: Request): string | null {
    if (userIds.has(req)) return userIds.get(req) ?? null;
    let userId: string | null = null;
    const header = req.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      try {
        const payload = this.jwt.verify<{ sub?: unknown }>(header.slice(7).trim());
        if (typeof payload.sub === 'string' && UUID_PATTERN.test(payload.sub)) userId = payload.sub;
      } catch {
        userId = null;
      }
    }
    userIds.set(req, userId);
    return userId;
  }
}
