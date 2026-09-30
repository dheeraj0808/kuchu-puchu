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

export enum UserStatus {
  Active = 'active',
  Suspended = 'suspended',
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
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @Index({ name: 'users_email_unique', unique: true })
  @Column(DataType.STRING(254))
  email: string | null;

  @Index({ name: 'users_phone_unique', unique: true })
  @Column(DataType.STRING(20))
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

  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  isActive: boolean;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  isBanned: boolean;

  @Column(DataType.DATE(3))
  lastLoginAt: Date | null;

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

  /** True when the account may authenticate. */
  canAuthenticate(): boolean {
    return this.isActive && !this.isBanned && this.status === UserStatus.Active;
  }
}
