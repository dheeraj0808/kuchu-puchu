import { Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';

/** Global catalogue entry. Never deleted — deactivate with isActive=false instead. */
@Table({ tableName: 'interests', underscored: true, timestamps: true })
export class Interest extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @Column({ type: DataType.STRING(64), allowNull: false })
  name: string;

  @Column({ type: DataType.STRING(64), allowNull: false, unique: 'interests_slug_unique' })
  slug: string;

  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  isActive: boolean;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE(3))
  override updatedAt: Date;
}
