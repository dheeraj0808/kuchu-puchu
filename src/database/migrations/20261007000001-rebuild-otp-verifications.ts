import { DataTypes, QueryTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

import { TABLE_OPTIONS_0900, createdAtColumn, ensureIndexes, uuidColumn } from './helpers';

const TABLE = 'otp_verifications';

/**
 * M06: otp_verifications exactly as guide §8 M06 (channel, purpose, no
 * user_id / max_attempts / updated_at; NOT NULL request_ip). Codes live
 * 5 minutes and the table holds no user data, so the old rows are deleted
 * and the table is recreated (owner decision; dev had 0 users). The number
 * of deleted rows is printed.
 */
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  if (await qi.tableExists(TABLE)) {
    const cols = (await qi.describeTable(TABLE)) as Record<string, unknown>;
    if ('purpose' in cols) return; // already rebuilt
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
      identifier_hash: { type: DataTypes.CHAR(64), allowNull: false },
      channel: { type: DataTypes.ENUM('sms', 'email'), allowNull: false },
      purpose: { type: DataTypes.ENUM('login', 'reauth'), allowNull: false },
      otp_hash: { type: DataTypes.CHAR(64), allowNull: false },
      attempts: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      expires_at: { type: DataTypes.DATE(3), allowNull: false },
      consumed_at: { type: DataTypes.DATE(3), allowNull: true },
      request_ip: { type: DataTypes.STRING(45), allowNull: false },
      created_at: createdAtColumn(),
    },
    TABLE_OPTIONS_0900,
  );
  await ensureIndexes(qi, TABLE, [
    { name: 'otp_identifier_created_idx', fields: ['identifier_hash', 'created_at'] },
    { name: 'otp_request_ip_created_idx', fields: ['request_ip', 'created_at'] },
  ]);
};

/** Development only: the pre-M06 shape, empty. */
export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await qi.dropTable(TABLE);
  await qi.createTable(
    TABLE,
    {
      id: uuidColumn({ primaryKey: true }),
      user_id: uuidColumn({ allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' }),
      identifier_hash: { type: DataTypes.CHAR(64), allowNull: false },
      identifier_type: { type: DataTypes.ENUM('email', 'phone'), allowNull: false },
      otp_hash: { type: DataTypes.CHAR(64), allowNull: false },
      expires_at: { type: DataTypes.DATE(3), allowNull: false },
      attempts: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      max_attempts: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
      consumed_at: { type: DataTypes.DATE(3), allowNull: true },
      request_ip: { type: DataTypes.STRING(45), allowNull: true },
      created_at: createdAtColumn(),
      updated_at: createdAtColumn(),
    },
    TABLE_OPTIONS_0900,
  );
};
