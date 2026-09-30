import {
  AutoIncrement,
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

import { User } from '../../users/models/user.model';

export enum SecurityEventType {
  OtpRequested = 'otp.requested',
  OtpRequestThrottled = 'otp.request_throttled',
  OtpVerified = 'otp.verified',
  OtpVerificationFailed = 'otp.verification_failed',
  OtpAttemptsExceeded = 'otp.attempts_exceeded',
  OtpDeliveryFailed = 'otp.delivery_failed',
  UserRegistered = 'user.registered',
  LoginSucceeded = 'auth.login_succeeded',
  LoginBlocked = 'auth.login_blocked',
  TokenRefreshed = 'auth.token_refreshed',
  RefreshTokenInvalid = 'auth.refresh_token_invalid',
  RefreshTokenReuseDetected = 'auth.refresh_token_reuse_detected',
  SessionRevoked = 'auth.session_revoked',
  Logout = 'auth.logout',
  LogoutAll = 'auth.logout_all',
  ProfileCreated = 'profile.created',
  ProfileDeleted = 'profile.deleted',
  AccountDeleted = 'account.deleted',
  UserStatusChanged = 'user.status_changed',
  /** A valid session was refused because the account is suspended, banned or deactivated. */
  AccountRestricted = 'auth.account_restricted',
}

@Table({
  tableName: 'security_events',
  underscored: true,
  timestamps: true,
  updatedAt: false,
})
export class SecurityEvent extends Model {
  /** BIGINT UNSIGNED (guide §4.2 append-only log); a string so ids beyond 2^53 stay exact. */
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT.UNSIGNED)
  override id: string;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  userId: string | null;

  @BelongsTo(() => User, { onDelete: 'SET NULL' })
  user?: User;

  /** Who did it (moderator/admin for admin.* events), when not the subject. */
  @Column(DataType.CHAR(36))
  actorUserId: string | null;

  @Column({ type: DataType.STRING(64), allowNull: false })
  eventType: SecurityEventType;

  @Column(DataType.STRING(45))
  ipAddress: string | null;

  @Column(DataType.STRING(255))
  userAgent: string | null;

  /** Never raw PII, OTPs or tokens; identifiers only as a 12-char HMAC prefix (hashIdentifier). */
  @Column(DataType.JSON)
  metadata: Record<string, unknown> | null;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt: Date;
}
