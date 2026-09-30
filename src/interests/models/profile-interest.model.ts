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
import { Profile } from '../../profiles/models/profile.model';
import { Interest } from './interest.model';

@Table({ tableName: 'profile_interests', underscored: true, timestamps: true })
export class ProfileInterest extends Model {
  @PrimaryKey
  @Default(uuidv7)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => Profile)
  @Column({ type: DataType.UUID, allowNull: false, unique: 'profile_interests_profile_interest_unique' })
  profileId: string;

  @ForeignKey(() => Interest)
  @Column({ type: DataType.UUID, allowNull: false, unique: 'profile_interests_profile_interest_unique' })
  interestId: string;

  @BelongsTo(() => Profile, { onDelete: 'CASCADE' })
  profile?: Profile;

  @BelongsTo(() => Interest, { onDelete: 'RESTRICT' })
  interest?: Interest;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE(3))
  override updatedAt: Date;
}
