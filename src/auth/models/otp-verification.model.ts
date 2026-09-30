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

import { User } from '../../users/models/user.model';

export enum IdentifierType {
  Email = 'email',
  Phone = 'phone',
}

@Table({ tableName: 'otp_verifications', underscored: true, timestamps: true })
export class OtpVerification extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  userId: string | null;

  @BelongsTo(() => User, { onDelete: 'SET NULL' })
  user?: User;

  /**
   * HMAC-SHA256 of the normalized identifier (email/phone). The raw
   * identifier is never persisted in this table.
   */
  @Column({ type: DataType.CHAR(64), allowNull: false })
  identifierHash: string;

  @Column({
    type: DataType.ENUM(...Object.values(IdentifierType)),
    allowNull: false,
  })
  identifierType: IdentifierType;

  /** HMAC-SHA256 of the OTP bound to this record. Never plaintext. */
  @Column({ type: DataType.CHAR(64), allowNull: false })
  otpHash: string;

  @Column({ type: DataType.DATE(3), allowNull: false })
  expiresAt: Date;

  @Default(0)
  @Column({ type: DataType.TINYINT.UNSIGNED, allowNull: false })
  attempts: number;

  @Column({ type: DataType.TINYINT.UNSIGNED, allowNull: false })
  maxAttempts: number;

  @Column(DataType.DATE(3))
  consumedAt: Date | null;

  @Column(DataType.STRING(45))
  requestIp: string | null;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE(3))
  override updatedAt: Date;
}
