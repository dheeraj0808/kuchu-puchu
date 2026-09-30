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

import type { Gender } from '../../profiles/models/profile.model';
import { User } from '../../users/models/user.model';

/**
 * Stored as VARCHAR (not a DB ENUM) so new values only need a code change.
 * Validation against this enum happens at the API boundary.
 */
export enum RelationshipIntent {
  LongTerm = 'LONG_TERM',
  ShortTerm = 'SHORT_TERM',
  Casual = 'CASUAL',
  Marriage = 'MARRIAGE',
  Friends = 'FRIENDS',
  Unsure = 'UNSURE',
}

@Table({ tableName: 'dating_preferences', underscored: true, timestamps: true })
export class DatingPreference extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false, unique: 'dating_preferences_user_id_unique' })
  userId: string;

  @BelongsTo(() => User, { onDelete: 'CASCADE' })
  user?: User;

  @Column({ type: DataType.TINYINT.UNSIGNED, allowNull: false })
  minAge: number;

  @Column({ type: DataType.TINYINT.UNSIGNED, allowNull: false })
  maxAge: number;

  /** JSON array of Gender values, validated before write. */
  @Column({ type: DataType.JSON, allowNull: false })
  preferredGenders: Gender[];

  @Column({ type: DataType.SMALLINT.UNSIGNED, allowNull: false })
  maxDistanceKm: number;

  @Column({ type: DataType.STRING(32), allowNull: false })
  relationshipIntent: RelationshipIntent;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE(3))
  override updatedAt: Date;
}
