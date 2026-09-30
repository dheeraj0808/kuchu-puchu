import { DataTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

import {
  TABLE_OPTIONS,
  createdAtColumn,
  dropTableIfExists,
  ensureIndexes,
  tableExists,
  uuidPrimaryKey,
} from './helpers';

const TABLE = 'security_events';

export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) {
    await qi.createTable(
      TABLE,
      {
        id: uuidPrimaryKey(),
        user_id: {
          type: DataTypes.UUID,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
        },
        event_type: { type: DataTypes.STRING(64), allowNull: false },
        ip_address: { type: DataTypes.STRING(45), allowNull: true },
        user_agent: { type: DataTypes.STRING(512), allowNull: true },
        metadata: { type: DataTypes.JSON, allowNull: true },
        created_at: createdAtColumn(),
      },
      TABLE_OPTIONS,
    );
  }

  await ensureIndexes(qi, TABLE, [
    {
      name: 'security_events_user_created_idx',
      fields: ['user_id', 'created_at'],
    },
    {
      name: 'security_events_type_created_idx',
      fields: ['event_type', 'created_at'],
    },
    { name: 'security_events_created_at_idx', fields: ['created_at'] },
  ]);
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await dropTableIfExists(qi, TABLE);
};
