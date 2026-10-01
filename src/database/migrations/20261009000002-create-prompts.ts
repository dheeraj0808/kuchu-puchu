import { DataTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

import { TABLE_OPTIONS_0900, createdAtColumn, ensureIndexes, updatedAtColumn, uuidColumn } from './helpers';

const TABLE = 'prompts';

/**
 * M08: prompts as guide §8 M08 (+ standard columns). `text` is unique so the
 * seeder can upsert by it (the spec gives prompts no other natural key).
 */
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  if (!(await qi.tableExists(TABLE))) {
    await qi.createTable(
      TABLE,
      {
        id: uuidColumn({ primaryKey: true }),
        text: { type: DataTypes.STRING(150), allowNull: false },
        category: { type: DataTypes.STRING(30), allowNull: false },
        is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        sort_order: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
        created_at: createdAtColumn(),
        updated_at: updatedAtColumn(),
      },
      TABLE_OPTIONS_0900,
    );
  }
  await ensureIndexes(qi, TABLE, [
    { name: 'prompts_text_unique', fields: ['text'], unique: true },
    { name: 'prompts_active_sort_idx', fields: ['is_active', 'sort_order'] },
  ]);
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await qi.dropTable(TABLE);
};
