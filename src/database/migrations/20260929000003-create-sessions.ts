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

const TABLE = 'sessions';

export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) {
    await qi.createTable(
      TABLE,
      {
        id: uuidPrimaryKey(),
        user_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        refresh_token_hash: { type: DataTypes.CHAR(64), allowNull: false },
        previous_refresh_token_hash: {
          type: DataTypes.CHAR(64),
          allowNull: true,
        },
        device_id: { type: DataTypes.STRING(128), allowNull: true },
        device_name: { type: DataTypes.STRING(128), allowNull: true },
        ip_address: { type: DataTypes.STRING(45), allowNull: true },
        user_agent: { type: DataTypes.STRING(512), allowNull: true },
        last_used_at: { type: DataTypes.DATE(3), allowNull: true },
        expires_at: { type: DataTypes.DATE(3), allowNull: false },
        revoked_at: { type: DataTypes.DATE(3), allowNull: true },
        revoked_reason: { type: DataTypes.STRING(64), allowNull: true },
        created_at: createdAtColumn(),
        updated_at: updatedAtColumn(),
      },
      TABLE_OPTIONS,
    );
  }

  await ensureIndexes(qi, TABLE, [
    { name: 'sessions_user_revoked_idx', fields: ['user_id', 'revoked_at'] },
    { name: 'sessions_user_device_idx', fields: ['user_id', 'device_id'] },
    { name: 'sessions_expires_at_idx', fields: ['expires_at'] },
    {
      name: 'sessions_refresh_token_hash_unique',
      fields: ['refresh_token_hash'],
      unique: true,
    },
  ]);
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await dropTableIfExists(qi, TABLE);
};
