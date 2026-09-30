import type { QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

import * as createUsers from './20260929000001-create-users';
import * as createOtpVerifications from './20260929000002-create-otp-verifications';
import * as createSessions from './20260929000003-create-sessions';
import * as createSecurityEvents from './20260929000004-create-security-events';
import * as createProfiles from './20260930000001-create-profiles';
import * as createInterests from './20261001000001-create-interests';
import * as createProfileInterests from './20261001000002-create-profile-interests';
import * as createDatingPreferences from './20261001000003-create-dating-preferences';
import * as seedInterests from './20261001000004-seed-interests';
import * as convertCollation from './20261002000001-convert-collation-utf8mb4-0900';
import * as createOutboxEvents from './20261003000001-create-outbox-events';
import * as usersStatusAndActivity from './20261004000001-users-status-and-activity';
import * as securityEventsBigintActor from './20261005000001-security-events-bigint-actor';

export interface MigrationDefinition {
  name: string;
  up: MigrationFn<QueryInterface>;
  down: MigrationFn<QueryInterface>;
}

/** Ordered list of migrations. Append new migrations at the end. */
export const migrations: MigrationDefinition[] = [
  { name: '20260929000001-create-users', ...createUsers },
  { name: '20260929000002-create-otp-verifications', ...createOtpVerifications },
  { name: '20260929000003-create-sessions', ...createSessions },
  { name: '20260929000004-create-security-events', ...createSecurityEvents },
  { name: '20260930000001-create-profiles', ...createProfiles },
  { name: '20261001000001-create-interests', ...createInterests },
  { name: '20261001000002-create-profile-interests', ...createProfileInterests },
  { name: '20261001000003-create-dating-preferences', ...createDatingPreferences },
  { name: '20261001000004-seed-interests', ...seedInterests },
  { name: '20261002000001-convert-collation-utf8mb4-0900', ...convertCollation },
  { name: '20261003000001-create-outbox-events', ...createOutboxEvents },
  { name: '20261004000001-users-status-and-activity', ...usersStatusAndActivity },
  { name: '20261005000001-security-events-bigint-actor', ...securityEventsBigintActor },
];
