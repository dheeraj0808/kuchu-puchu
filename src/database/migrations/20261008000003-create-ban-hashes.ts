import { DataTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

import { TABLE_OPTIONS_0900, UUID_COLUMN_TYPE, createdAtColumn, ensureIndexes, updatedAtColumn, uuidColumn } from './helpers';

const TABLE = 'ban_hashes';

/**
 * ban_hashes exactly as guide §8 M15 (+ standard columns). Created in M07,
 * because deleting a banned account must keep its hashes; M15 adds bans.
 * source_user_id has no foreign key: the spec gives none, and the row must
 * outlive anything done to the user.
 */
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  if (!(await qi.tableExists(TABLE))) {
    await qi.createTable(
      TABLE,
      {
        id: uuidColumn({ primaryKey: true }),
        hash_type: { type: DataTypes.ENUM('identifier', 'photo', 'device'), allowNull: false },
        hash: { type: DataTypes.CHAR(64), allowNull: false },
        source_user_id: { type: UUID_COLUMN_TYPE, allowNull: true },
        created_at: createdAtColumn(),
        updated_at: updatedAtColumn(),
      },
      TABLE_OPTIONS_0900,
    );
  }
  await ensureIndexes(qi, TABLE, [{ name: 'ban_hashes_type_hash_unique', fields: ['hash_type', 'hash'], unique: true }]);
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await qi.dropTable(TABLE);
};
