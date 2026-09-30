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

const TABLE = 'users';

export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) {
    await qi.createTable(
      TABLE,
      {
        id: uuidPrimaryKey(),
        email: { type: DataTypes.STRING(254), allowNull: true },
        phone: { type: DataTypes.STRING(20), allowNull: true },
        email_verified_at: { type: DataTypes.DATE(3), allowNull: true },
        phone_verified_at: { type: DataTypes.DATE(3), allowNull: true },
        status: {
          type: DataTypes.ENUM('active', 'suspended', 'deactivated'),
          allowNull: false,
          defaultValue: 'active',
        },
        role: {
          type: DataTypes.ENUM('user', 'moderator', 'admin'),
          allowNull: false,
          defaultValue: 'user',
        },
        is_active: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        is_banned: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        last_login_at: { type: DataTypes.DATE(3), allowNull: true },
        created_at: createdAtColumn(),
        updated_at: updatedAtColumn(),
        deleted_at: { type: DataTypes.DATE(3), allowNull: true },
      },
      TABLE_OPTIONS,
    );
  }

  await ensureIndexes(qi, TABLE, [
    { name: 'users_email_unique', fields: ['email'], unique: true },
    { name: 'users_phone_unique', fields: ['phone'], unique: true },
    { name: 'users_status_idx', fields: ['status'] },
    { name: 'users_deleted_at_idx', fields: ['deleted_at'] },
    { name: 'users_created_at_idx', fields: ['created_at'] },
  ]);
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await dropTableIfExists(qi, TABLE);
};
