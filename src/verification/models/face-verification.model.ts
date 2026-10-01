import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';

import { uuidv7 } from '../../common/utils/uuid';
import { User } from '../../users/models/user.model';

export enum FaceVerificationStatus {
  Created = 'created',
  Processing = 'processing',
  Approved = 'approved',
  PendingReview = 'pending_review',
  Rejected = 'rejected',
  Expired = 'expired',
}

/** Reasons the user can act on (guide M11). duplicate_suspected is set by moderation (M15). */
export enum FaceRejectionReason {
  NotLive = 'not_live',
  FaceNotVisible = 'face_not_visible',
  PoorQuality = 'poor_quality',
  DuplicateSuspected = 'duplicate_suspected',
}

/** Still waiting for a result: one of these per user at most. */
export const LIVE_FACE_STATUSES = [FaceVerificationStatus.Created, FaceVerificationStatus.Processing] as const;

/** Parses MySQL DECIMAL (a string from mysql2) into a number. */
function decimal(this: Model, key: string): number | null {
  const raw: unknown = this.getDataValue(key);
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** guide §8 M11: one row per live-selfie attempt. */
@Table({ tableName: 'face_verifications', underscored: true, timestamps: true })
export class FaceVerification extends Model {
  @PrimaryKey
  @Default(uuidv7)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  userId: string;

  @BelongsTo(() => User, { onDelete: 'RESTRICT' })
  user?: User;

  /** e.g. rekognition-liveness, fake. */
  @Column({ type: DataType.STRING(30), allowNull: false })
  provider: string;

  /** The provider's session id. Server-side only: never returned by the API, logged or put in events. */
  @Column({ type: DataType.STRING(100), allowNull: false })
  providerSessionId: string;

  @Default(FaceVerificationStatus.Created)
  @Column({ type: DataType.ENUM(...Object.values(FaceVerificationStatus)), allowNull: false })
  status: FaceVerificationStatus;

  /** From the provider, fetched server-side. Never from the app. */
  @Column({
    type: DataType.DECIMAL(5, 2),
    get(this: FaceVerification): number | null {
      return decimal.call(this, 'livenessScore');
    },
  })
  livenessScore: number | null;

  /** v/<id>.webp in the private bucket. Never returned by any API. */
  @Column(DataType.STRING(200))
  selfieKey: string | null;

  @Column(DataType.STRING(40))
  rejectionReason: FaceRejectionReason | null;

  /** Set for human decisions (M15). */
  @Column(DataType.UUID)
  reviewerId: string | null;

  @Column(DataType.DATE(3))
  reviewedAt: Date | null;

  /** The consent screen version shown before capture. */
  @Column({ type: DataType.STRING(20), allowNull: false })
  consentVersion: string;

  @Column({ type: DataType.DATE(3), allowNull: false })
  consentedAt: Date;

  /** Set once the attempt is decided (approved, pending_review or rejected). Counted for the attempt quota. */
  @Column(DataType.DATE(3))
  decidedAt: Date | null;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE(3))
  override updatedAt: Date;
}
