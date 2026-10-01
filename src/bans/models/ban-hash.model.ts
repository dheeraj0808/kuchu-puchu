import { Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';

import { uuidv7 } from '../../common/utils/uuid';

export enum BanHashType {
  Identifier = 'identifier',
  Photo = 'photo',
  Device = 'device',
}

/** guide §8 M15: hashes of a banned person's identifiers, photos and devices. Never the values. */
@Table({ tableName: 'ban_hashes', underscored: true, timestamps: true })
export class BanHash extends Model {
  @PrimaryKey
  @Default(uuidv7)
  @Column(DataType.UUID)
  override id: string;

  @Column({ type: DataType.ENUM(...Object.values(BanHashType)), allowNull: false })
  hashType: BanHashType;

  /** HMAC-SHA256 (identifier, device) or SHA-256 (photo, M12). */
  @Column({ type: DataType.CHAR(64), allowNull: false })
  hash: string;

  @Column(DataType.UUID)
  sourceUserId: string | null;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE(3))
  override updatedAt: Date;
}
