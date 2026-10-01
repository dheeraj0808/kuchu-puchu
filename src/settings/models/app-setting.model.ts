import { Column, DataType, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';

/** guide §8 M08: key-value runtime config. No id (key is the PK), no created_at. */
@Table({ tableName: 'app_settings', underscored: true, timestamps: true, createdAt: false })
export class AppSetting extends Model {
  @PrimaryKey
  @Column({ type: DataType.STRING(64), allowNull: false })
  key: string;

  /** Validated by the key's parser (settings.registry.ts). */
  @Column({ type: DataType.JSON, allowNull: false })
  value: unknown;

  /** Admin who changed it (M15); null for seeded values. */
  @Column(DataType.UUID)
  updatedBy: string | null;

  @UpdatedAt
  @Column(DataType.DATE(3))
  override updatedAt: Date;
}
