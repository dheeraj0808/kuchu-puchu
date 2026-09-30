import type { UserRole } from '../../users/models/user.model';

export interface JwtPayload {
  sub: string;
  sid: string;
  role: UserRole;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
}
