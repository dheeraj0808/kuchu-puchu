import { Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table } from 'sequelize-typescript';

import { uuidv7 } from '../../common/utils/uuid';

/** The kind of identifier: hashed as "<type>:<normalised>" and used by UsersService lookups. */
export enum IdentifierType {
  Email = 'email',
  Phone = 'phone',
}

/** How a code is delivered (guide M06 `channel`). sms ⇔ phone, email ⇔ email. */
export enum OtpChannel {
  Sms = 'sms',
  Email = 'email',
}

export enum OtpPurpose {
  Login = 'login',
  Reauth = 'reauth',
}

export function identifierTypeOf(channel: OtpChannel): IdentifierType {
  return channel === OtpChannel.Sms ? IdentifierType.Phone : IdentifierType.Email;
}

export function channelOf(type: IdentifierType): OtpChannel {
  return type === IdentifierType.Phone ? OtpChannel.Sms : OtpChannel.Email;
}

/** One row per code sent (guide M06). No updated_at; the identifier itself is never stored. */
@Table({ tableName: 'otp_verifications', underscored: true, timestamps: true, updatedAt: false })
export class OtpVerification extends Model {
  @PrimaryKey
  @Default(uuidv7)
  @Column(DataType.UUID)
  override id: string;

  /** HMAC-SHA256(OTP_HASH_SECRET, "<type>:<normalised identifier>"). */
  @Column({ type: DataType.CHAR(64), allowNull: false })
  identifierHash: string;

  @Column({ type: DataType.ENUM(...Object.values(OtpChannel)), allowNull: false })
  channel: OtpChannel;

  @Column({ type: DataType.ENUM(...Object.values(OtpPurpose)), allowNull: false })
  purpose: OtpPurpose;

  /** HMAC of the code. Never plaintext; compared in constant time. */
  @Column({ type: DataType.CHAR(64), allowNull: false })
  otpHash: string;

  @Default(0)
  @Column({ type: DataType.TINYINT.UNSIGNED, allowNull: false })
  attempts: number;

  @Column({ type: DataType.DATE(3), allowNull: false })
  expiresAt: Date;

  @Column(DataType.DATE(3))
  consumedAt: Date | null;

  @Column({ type: DataType.STRING(45), allowNull: false })
  requestIp: string;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt: Date;
}
