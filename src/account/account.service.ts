import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import type { Sequelize } from 'sequelize-typescript';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { IdentifierType } from '../auth/models/otp-verification.model';
import { OtpService } from '../auth/services/otp.service';
import { SessionRevokeReason, SessionService } from '../auth/services/session.service';
import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import type { RequestContext } from '../common/utils/request-context';
import { PreferencesService } from '../preferences/preferences.service';
import { ProfilesService } from '../profiles/profiles.service';
import { SecurityEventType } from '../security/models/security-event.model';
import { SecurityEventsService } from '../security/security-events.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class AccountService {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly profiles: ProfilesService,
    private readonly otp: OtpService,
    private readonly securityEvents: SecurityEventsService,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly preferences: PreferencesService,
  ) {}

  /**
   * Deletes the caller's account atomically:
   * revoke all sessions → delete preferences → deactivate + scrub profile (incl. interest
   * selections) → anonymize + soft-delete user. The global interest catalogue is untouched.
   * Security events and OTP audit rows are retained (they hold only hashed identifiers).
   */
  async deleteAccount(principal: AuthenticatedUser, ctx: RequestContext): Promise<void> {
    await this.sequelize.transaction(async (transaction) => {
      const user = await this.users.findByIdForUpdate(principal.userId, transaction);
      if (!user) {
        throw new AppException(ErrorCode.Unauthorized);
      }

      // Keyed hashes (never raw identifiers) so abuse/ban-evasion checks remain possible.
      const identifierHashes = [
        user.email ? this.otp.hashIdentifier(IdentifierType.Email, user.email) : null,
        user.phone ? this.otp.hashIdentifier(IdentifierType.Phone, user.phone) : null,
      ].filter((h): h is string => h !== null);
      const wasBanned = user.isBanned;

      const revokedSessions = await this.sessions.revokeAllForUser(
        user.id,
        SessionRevokeReason.AccountDeleted,
        transaction,
      );
      const preferencesDeleted = (await this.preferences.deleteForUser(user.id, transaction)) > 0;
      const profileDeactivated = await this.profiles.deactivateForAccountDeletion(user.id, transaction);
      await this.users.anonymizeAndSoftDelete(user, transaction);

      await this.securityEvents.record({
        eventType: SecurityEventType.AccountDeleted,
        userId: user.id,
        context: ctx,
        metadata: { revokedSessions, preferencesDeleted, profileDeactivated, wasBanned, identifierHashes },
        transaction,
      });
    });
  }
}
