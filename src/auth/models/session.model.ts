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
  UpdatedAt,
} from 'sequelize-typescript';

import { uuidv7 } from '../../common/utils/uuid';
import type { ClientPlatform } from '../../common/utils/request-context';
import { User } from '../../users/models/user.model';

/** Guide M06 revoked_reason values. */
export enum SessionRevokeReason {
  Logout = 'logout',
  LogoutAll = 'logout_all',
  Replaced = 'replaced',
  ReuseDetected = 'reuse_detected',
  Restricted = 'restricted',
  Deleted = 'deleted',
}

/** One row per signed-in device (guide M06). */
@Table({ tableName: 'sessions', underscored: true, timestamps: true })
export class Session extends Model {
  @PrimaryKey
  @Default(uuidv7)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  userId: string;

  @BelongsTo(() => User, { onDelete: 'RESTRICT' })
  user?: User;

  /** HMAC of the current refresh secret. Never the raw token. */
  @Column({ type: DataType.CHAR(64), allowNull: false })
  refreshTokenHash: string;

  /** HMAC of the secret this one replaced; presenting it again is reuse. */
  @Column(DataType.CHAR(64))
  previousTokenHash: string | null;

  @Column({ type: DataType.STRING(100), allowNull: false })
  deviceId: string;

  @Column({ type: DataType.STRING(100), allowNull: false })
  deviceName: string;

  @Column({ type: DataType.ENUM('android', 'ios'), allowNull: false })
  platform: ClientPlatform;

  @Column({ type: DataType.STRING(20), allowNull: false })
  appVersion: string;

  /** Last seen values. */
  @Column({ type: DataType.STRING(45), allowNull: false })
  ipAddress: string;

  @Column({ type: DataType.STRING(255), allowNull: false })
  userAgent: string;

  @Column({ type: DataType.DATE(3), allowNull: false })
  lastUsedAt: Date;

  /** Sliding: now + SESSION_SLIDING_DAYS on each refresh, never past absoluteExpiresAt. */
  @Column({ type: DataType.DATE(3), allowNull: false })
  expiresAt: Date;

  /** created_at + SESSION_MAX_DAYS. Never extended. */
  @Column({ type: DataType.DATE(3), allowNull: false })
  absoluteExpiresAt: Date;

  /** Set by a step-up OTP; counts for 10 minutes. */
  @Column(DataType.DATE(3))
  reauthenticatedAt: Date | null;

  @Column(DataType.DATE(3))
  revokedAt: Date | null;

  @Column(DataType.STRING(40))
  revokedReason: SessionRevokeReason | null;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE(3))
  override updatedAt: Date;

  isUsable(now: Date = new Date()): boolean {
    return !this.revokedAt && this.expiresAt.getTime() > now.getTime() && this.absoluteExpiresAt.getTime() > now.getTime();
  }
}
