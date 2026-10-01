import { Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';

import { uuidv7 } from '../../common/utils/uuid';

/** guide §8 M08: profile question catalogue. Never deleted — deactivate instead. */
@Table({ tableName: 'prompts', underscored: true, timestamps: true })
export class Prompt extends Model {
  @PrimaryKey
  @Default(uuidv7)
  @Column(DataType.UUID)
  override id: string;

  @Column({ type: DataType.STRING(150), allowNull: false, unique: 'prompts_text_unique' })
  text: string;

  @Column({ type: DataType.STRING(30), allowNull: false })
  category: string;

  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  isActive: boolean;

  @Default(0)
  @Column({ type: DataType.SMALLINT, allowNull: false })
  sortOrder: number;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE(3))
  override updatedAt: Date;
}
