import { DataTypes, Sequelize, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

import { TABLE_OPTIONS_0900, UUID_COLUMN_TYPE } from './helpers';

const TABLE = 'app_settings';

/** M08: app_settings exactly as guide §8 M08: no id (key is the PK), no created_at. */
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  if (await qi.tableExists(TABLE)) return;
  await qi.createTable(
    TABLE,
    {
      key: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
      value: { type: DataTypes.JSON, allowNull: false },
      updated_by: { type: UUID_COLUMN_TYPE, allowNull: true },
      updated_at: {
        type: DataTypes.DATE(3),
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'),
      },
    },
    TABLE_OPTIONS_0900,
  );
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await qi.dropTable(TABLE);
};
