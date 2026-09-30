import { DataTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

import {
  TABLE_OPTIONS,
  createdAtColumn,
  dropTableIfExists,
  ensureIndexes,
  tableExists,
  updatedAtColumn,
  uuidPrimaryKey,
} from './helpers';

const TABLE = 'interests';

export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) {
    await qi.createTable(
      TABLE,
      {
        id: uuidPrimaryKey(),
        name: { type: DataTypes.STRING(64), allowNull: false },
        slug: { type: DataTypes.STRING(64), allowNull: false },
        is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        created_at: createdAtColumn(),
        updated_at: updatedAtColumn(),
      },
      TABLE_OPTIONS,
    );
  }

  await ensureIndexes(qi, TABLE, [
    { name: 'interests_slug_unique', fields: ['slug'], unique: true },
    { name: 'interests_active_name_idx', fields: ['is_active', 'name'] },
  ]);
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await dropTableIfExists(qi, TABLE);
};
