import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';

import { uuidv7 } from '../../common/utils/uuid';
import { User } from '../../users/models/user.model';

export enum DataExportStatus {
  Pending = 'pending',
  Processing = 'processing',
  Ready = 'ready',
  Expired = 'expired',
  Failed = 'failed',
}

/** guide §8 M07: one row per export request. */
@Table({ tableName: 'data_export_requests', underscored: true, timestamps: true })
export class DataExportRequest extends Model {
  @PrimaryKey
  @Default(uuidv7)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  userId: string;

  @BelongsTo(() => User, { onDelete: 'RESTRICT' })
  user?: User;

  @Default(DataExportStatus.Pending)
  @Column({ type: DataType.ENUM(...Object.values(DataExportStatus)), allowNull: false })
  status: DataExportStatus;

  /** S3 key of the ZIP in the private bucket: exports/<id>.zip. */
  @Column(DataType.STRING(200))
  fileKey: string | null;

  /** Download link valid until (24 h after it was built). */
  @Column(DataType.DATE(3))
  expiresAt: Date | null;

  @Column(DataType.DATE(3))
  completedAt: Date | null;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE(3))
  override updatedAt: Date;
}
