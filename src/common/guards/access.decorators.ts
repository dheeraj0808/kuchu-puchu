import { SetMetadata } from '@nestjs/common';

import type { UserRole } from '../../users/models/user.model';
import type { EntitlementKey } from '../entitlements/entitlements';

export const ROLES_KEY = 'kp:roles';
export const ENTITLEMENT_KEY = 'kp:entitlement';

/**
 * Roles allowed on a route or controller. Enforced by RolesGuard, which must
 * run after JwtAuthGuard: `@UseGuards(JwtAuthGuard, RolesGuard)`.
 */
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);

export interface RequiredEntitlement {
  key: EntitlementKey;
  minLevel?: string;
}

/**
 * Entitlement a route needs (guide M21). Enforced by EntitlementGuard, which
 * must run after JwtAuthGuard: `@UseGuards(JwtAuthGuard, EntitlementGuard)`.
 * For tiered features pass the lowest level that is enough.
 */
export const RequiresEntitlement = (key: EntitlementKey, minLevel?: string): MethodDecorator & ClassDecorator =>
  SetMetadata(ENTITLEMENT_KEY, { key, minLevel } satisfies RequiredEntitlement);
