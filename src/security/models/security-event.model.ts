import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

import { uuidv7 } from '../../common/utils/uuid';
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
}

@Table({
  tableName: 'security_events',
  underscored: true,
  timestamps: true,
  updatedAt: false,
})
export class SecurityEvent extends Model {
  @PrimaryKey
  @Default(uuidv7)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  userId: string | null;

  @BelongsTo(() => User, { onDelete: 'SET NULL' })
  user?: User;

  @Column({ type: DataType.STRING(64), allowNull: false })
  eventType: SecurityEventType;

  @Column(DataType.STRING(45))
  ipAddress: string | null;

  @Column(DataType.STRING(512))
  userAgent: string | null;

  /** Must never contain OTPs, tokens or raw PII. */
  @Column(DataType.JSON)
  metadata: Record<string, unknown> | null;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt: Date;
}
