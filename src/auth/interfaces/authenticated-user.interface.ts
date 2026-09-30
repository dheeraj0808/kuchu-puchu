import type { UserRole } from '../../users/models/user.model';

export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
  role: UserRole;
}
