import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  DeletedAt,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';

import { uuidv7 } from '../../common/utils/uuid';
import { User } from '../../users/models/user.model';

export enum Gender {
  Woman = 'woman',
  Man = 'man',
  NonBinary = 'non_binary',
  Other = 'other',
}

export enum ProfileVisibility {
  Public = 'public',
  MatchesOnly = 'matches_only',
  Hidden = 'hidden',
}

/** Parses MySQL DECIMAL (returned as string by mysql2) into a number. */
function decimalGetter(this: Model, key: string): number | null {
  const raw: unknown = this.getDataValue(key);
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

@Table({ tableName: 'profiles', underscored: true, paranoid: true, timestamps: true })
export class Profile extends Model {
  @PrimaryKey
  @Default(uuidv7)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false, unique: 'profiles_user_id_unique' })
  userId: string;

  @BelongsTo(() => User, { onDelete: 'CASCADE' })
  user?: User;

  // Nullable at the DB level so account deletion can scrub them; the API requires them.
  @Column(DataType.STRING(50))
  displayName: string | null;

  /** ISO date (YYYY-MM-DD). Age is always derived, never stored. */
  @Column(DataType.DATEONLY)
  dateOfBirth: string | null;

  @Column(DataType.ENUM(...Object.values(Gender)))
  gender: Gender | null;

  @Column(DataType.STRING(500))
  bio: string | null;

  @Column(DataType.STRING(100))
  occupation: string | null;

  @Column(DataType.STRING(100))
  education: string | null;

  @Column(DataType.STRING(100))
  city: string | null;

  @Column(DataType.STRING(100))
  state: string | null;

  /** ISO 3166-1 alpha-2. */
  @Column(DataType.CHAR(2))
  country: string | null;

  @Column({
    type: DataType.DECIMAL(9, 6),
    get(this: Profile): number | null {
      return decimalGetter.call(this, 'latitude');
    },
  })
  latitude: number | null;

  @Column({
    type: DataType.DECIMAL(9, 6),
    get(this: Profile): number | null {
      return decimalGetter.call(this, 'longitude');
    },
  })
  longitude: number | null;

  @Column(DataType.DATE(3))
  locationUpdatedAt: Date | null;

  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  isDiscoverable: boolean;

  @Default(ProfileVisibility.Public)
  @Column({ type: DataType.ENUM(...Object.values(ProfileVisibility)), allowNull: false })
  profileVisibility: ProfileVisibility;

  /** 0–100, always computed server-side by ProfileCompletionService. */
  @Default(0)
  @Column({ type: DataType.TINYINT.UNSIGNED, allowNull: false })
  profileCompletion: number;

  /** Live selfie approved (M11). NULL until then, and again when moderation asks for a new selfie. */
  @Column(DataType.DATE(3))
  faceVerifiedAt: Date | null;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE(3))
  override updatedAt: Date;

  @DeletedAt
  @Column(DataType.DATE(3))
  override deletedAt: Date | null;
}
