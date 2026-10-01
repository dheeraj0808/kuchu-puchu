import { DataTypes, QueryTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

import { TABLE_OPTIONS_0900, createdAtColumn, ensureIndexes, updatedAtColumn, uuidColumn } from './helpers';

const TABLE = 'sessions';

/**
 * M06: sessions exactly as guide §8 M06 (previous_token_hash, platform,
 * app_version, absolute_expires_at, reauthenticated_at, revoked_reason
 * VARCHAR(40), the two spec indexes, FK ON DELETE RESTRICT per §4.2).
 * Existing sessions are deleted and the table recreated (owner decision; dev
 * had 0 users), which signs every device out once. The number of deleted
 * rows is printed.
 */
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  if (await qi.tableExists(TABLE)) {
    const cols = (await qi.describeTable(TABLE)) as Record<string, unknown>;
    if ('absolute_expires_at' in cols) return; // already rebuilt
    const [{ n }] = await qi.sequelize.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${TABLE}`, {
      type: QueryTypes.SELECT,
    });
    await qi.dropTable(TABLE);
    console.log(`[M06] ${TABLE}: deleted ${Number(n)} rows and rebuilt the table`);
  }
  await qi.createTable(
    TABLE,
    {
      id: uuidColumn({ primaryKey: true }),
      user_id: uuidColumn({
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      }),
      refresh_token_hash: { type: DataTypes.CHAR(64), allowNull: false },
      previous_token_hash: { type: DataTypes.CHAR(64), allowNull: true },
      device_id: { type: DataTypes.STRING(100), allowNull: false },
      device_name: { type: DataTypes.STRING(100), allowNull: false },
      platform: { type: DataTypes.ENUM('android', 'ios'), allowNull: false },
      app_version: { type: DataTypes.STRING(20), allowNull: false },
      ip_address: { type: DataTypes.STRING(45), allowNull: false },
      user_agent: { type: DataTypes.STRING(255), allowNull: false },
      last_used_at: { type: DataTypes.DATE(3), allowNull: false },
      expires_at: { type: DataTypes.DATE(3), allowNull: false },
      absolute_expires_at: { type: DataTypes.DATE(3), allowNull: false },
      reauthenticated_at: { type: DataTypes.DATE(3), allowNull: true },
      revoked_at: { type: DataTypes.DATE(3), allowNull: true },
      revoked_reason: { type: DataTypes.STRING(40), allowNull: true },
      created_at: createdAtColumn(),
      updated_at: updatedAtColumn(),
    },
    TABLE_OPTIONS_0900,
  );
  await ensureIndexes(qi, TABLE, [
    { name: 'sessions_user_revoked_idx', fields: ['user_id', 'revoked_at'] },
    { name: 'sessions_user_device_idx', fields: ['user_id', 'device_id'] },
  ]);
};

/** Development only: the pre-M06 shape, empty. */
export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await qi.dropTable(TABLE);
  await qi.createTable(
    TABLE,
    {
      id: uuidColumn({ primaryKey: true }),
      user_id: uuidColumn({ references: { model: 'users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' }),
      refresh_token_hash: { type: DataTypes.CHAR(64), allowNull: false },
      previous_refresh_token_hash: { type: DataTypes.CHAR(64), allowNull: true },
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
    TABLE_OPTIONS_0900,
  );
};
