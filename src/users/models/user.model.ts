import {
  Column,
  CreatedAt,
  DataType,
  DeletedAt,
  Default,
  HasMany,
  Index,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';

import { Session } from '../../auth/models/session.model';
import { uuidv7 } from '../../common/utils/uuid';

export enum UserStatus {
  Active = 'active',
  Suspended = 'suspended',
  Banned = 'banned',
  Deactivated = 'deactivated',
}

export enum UserRole {
  User = 'user',
  Moderator = 'moderator',
  Admin = 'admin',
}

@Table({
  tableName: 'users',
  underscored: true,
  paranoid: true,
  timestamps: true,
  defaultScope: {
    attributes: { exclude: ['deletedAt'] },
  },
})
export class User extends Model {
  @PrimaryKey
  @Default(uuidv7)
  @Column(DataType.UUID)
  override id: string;

  @Index({ name: 'users_email_unique', unique: true })
  @Column(DataType.STRING(254))
  email: string | null;

  /** E.164, e.g. +919812345678. */
  @Index({ name: 'users_phone_unique', unique: true })
  @Column(DataType.STRING(16))
  phone: string | null;

  @Column(DataType.DATE(3))
  emailVerifiedAt: Date | null;

  @Column(DataType.DATE(3))
  phoneVerifiedAt: Date | null;

  @Default(UserStatus.Active)
  @Column({
    type: DataType.ENUM(...Object.values(UserStatus)),
    allowNull: false,
  })
  status: UserStatus;

  @Default(UserRole.User)
  @Column({
    type: DataType.ENUM(...Object.values(UserRole)),
    allowNull: false,
  })
  role: UserRole;

  /** Set with status suspended; the M15 lift job clears it. */
  @Column(DataType.DATE(3))
  suspendedUntil: Date | null;

  /** Hidden from discovery pending review (M14/M15). */
  @Column(DataType.DATE(3))
  discoveryRestrictedAt: Date | null;

  @Column(DataType.DATE(3))
  lastLoginAt: Date | null;

  /** Updated at most every 5 min (Redis throttle). */
  @Column(DataType.DATE(3))
  lastActiveAt: Date | null;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE(3))
  override updatedAt: Date;

  @DeletedAt
  @Column(DataType.DATE(3))
  override deletedAt: Date | null;

  @HasMany(() => Session)
  sessions?: Session[];

  /** Guide M04: status is active and the account is not deleted. */
  canAuthenticate(): boolean {
    return canAuthenticate(this);
  }
}

/** Shared by the model and the session cache, so both apply the same rule. */
export function canAuthenticate(user: { status: UserStatus | string; deletedAt?: Date | null }): boolean {
  return user.status === UserStatus.Active && !user.deletedAt;
}
