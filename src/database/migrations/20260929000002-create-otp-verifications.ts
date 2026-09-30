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

const TABLE = 'otp_verifications';

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
        identifier_hash: { type: DataTypes.CHAR(64), allowNull: false },
        identifier_type: {
          type: DataTypes.ENUM('email', 'phone'),
          allowNull: false,
        },
        otp_hash: { type: DataTypes.CHAR(64), allowNull: false },
        expires_at: { type: DataTypes.DATE(3), allowNull: false },
        attempts: {
          type: DataTypes.TINYINT.UNSIGNED,
          allowNull: false,
          defaultValue: 0,
        },
        max_attempts: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
        consumed_at: { type: DataTypes.DATE(3), allowNull: true },
        request_ip: { type: DataTypes.STRING(45), allowNull: true },
        created_at: createdAtColumn(),
        updated_at: updatedAtColumn(),
      },
      TABLE_OPTIONS,
    );
  }

  await ensureIndexes(qi, TABLE, [
    {
      name: 'otp_identifier_created_idx',
      fields: ['identifier_hash', 'identifier_type', 'created_at'],
    },
    { name: 'otp_expires_at_idx', fields: ['expires_at'] },
    { name: 'otp_user_id_idx', fields: ['user_id'] },
    { name: 'otp_request_ip_created_idx', fields: ['request_ip', 'created_at'] },
  ]);
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await dropTableIfExists(qi, TABLE);
};
