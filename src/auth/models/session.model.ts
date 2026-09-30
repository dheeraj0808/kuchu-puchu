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
import { User } from '../../users/models/user.model';

@Table({ tableName: 'sessions', underscored: true, timestamps: true })
export class Session extends Model {
  @PrimaryKey
  @Default(uuidv7)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  userId: string;

  @BelongsTo(() => User, { onDelete: 'CASCADE' })
  user?: User;

  /** HMAC-SHA256 of the current refresh token secret. Never the raw token. */
  @Column({ type: DataType.CHAR(64), allowNull: false })
  refreshTokenHash: string;

  /** Hash of the previously rotated token; used for reuse detection. */
  @Column(DataType.CHAR(64))
  previousRefreshTokenHash: string | null;

  @Column(DataType.STRING(128))
  deviceId: string | null;

  @Column(DataType.STRING(128))
  deviceName: string | null;

  @Column(DataType.STRING(45))
  ipAddress: string | null;

  @Column(DataType.STRING(512))
  userAgent: string | null;

  @Column(DataType.DATE(3))
  lastUsedAt: Date | null;

  @Column({ type: DataType.DATE(3), allowNull: false })
  expiresAt: Date;

  @Column(DataType.DATE(3))
  revokedAt: Date | null;

  @Column(DataType.STRING(64))
  revokedReason: string | null;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE(3))
  override updatedAt: Date;

  isUsable(now: Date = new Date()): boolean {
    return !this.revokedAt && this.expiresAt.getTime() > now.getTime();
  }
}
