import { DataTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

import { TABLE_OPTIONS_0900, createdAtColumn, ensureIndexes, updatedAtColumn, uuidColumn } from './helpers';

const TABLE = 'data_export_requests';

/** M07: data_export_requests exactly as guide §8 M07 (+ standard columns). */
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  if (!(await qi.tableExists(TABLE))) {
    await qi.createTable(
      TABLE,
      {
        id: uuidColumn({ primaryKey: true }),
        user_id: uuidColumn({ references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'CASCADE' }),
        status: {
          type: DataTypes.ENUM('pending', 'processing', 'ready', 'expired', 'failed'),
          allowNull: false,
          defaultValue: 'pending',
        },
        file_key: { type: DataTypes.STRING(200), allowNull: true },
        expires_at: { type: DataTypes.DATE(3), allowNull: true },
        completed_at: { type: DataTypes.DATE(3), allowNull: true },
        created_at: createdAtColumn(),
        updated_at: updatedAtColumn(),
      },
      TABLE_OPTIONS_0900,
    );
  }
  await ensureIndexes(qi, TABLE, [{ name: 'data_export_requests_user_created_idx', fields: ['user_id', 'created_at'] }]);
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await qi.dropTable(TABLE);
};
