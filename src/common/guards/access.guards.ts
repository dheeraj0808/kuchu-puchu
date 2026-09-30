import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import type { UserRole } from '../../users/models/user.model';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { AppException, ErrorCode } from '../exceptions/app.exception';
import { OnboardingStatusService } from '../onboarding/onboarding-status.service';
import { ENTITLEMENT_KEY, ROLES_KEY, type RequiredEntitlement } from './access.decorators';

/** The principal JwtAuthGuard attached. These guards never read the token themselves. */
function principal(context: ExecutionContext): AuthenticatedUser {
  const user = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>().user;
  if (!user) throw new AppException(ErrorCode.Unauthorized);
  return user;
}

/**
 * Allows the route only for the roles in @Roles(). The role comes from
 * `req.user.role`, which JwtStrategy loads from the users row on every
 * request (guide S3) — a role claim inside the token is never used.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;
    const { role } = principal(context);
    if (!roles.includes(role)) throw new AppException(ErrorCode.Forbidden);
    return true;
  }
}

/**
 * Most dating features need an approved live selfie (guide: "Verified user").
 * Otherwise 403 ONBOARDING_INCOMPLETE with details.nextStep, so the app can
 * send the user to the right screen. Built in M01, applied to routes after M11.
 */
@Injectable()
export class VerifiedUserGuard implements CanActivate {
  constructor(private readonly onboarding: OnboardingStatusService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { userId } = principal(context);
    const status = await this.onboarding.getStatus(userId);
    if (!status.selfieApproved) {
      throw new AppException(ErrorCode.OnboardingIncomplete, { nextStep: status.nextStep });
    }
    return true;
  }
}

/** Allows the route only if the user's plan includes @RequiresEntitlement(). */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<RequiredEntitlement | undefined>(ENTITLEMENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    const { userId } = principal(context);
    if (!(await this.entitlements.has(userId, required.key, required.minLevel))) {
      throw new AppException(ErrorCode.EntitlementRequired, { entitlement: required.key });
    }
    return true;
  }
}
