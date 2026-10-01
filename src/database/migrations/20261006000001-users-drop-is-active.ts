import { DataTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

const TABLE = 'users';

/**
 * users.is_active is not in the spec (guide §8 M04) and nothing reads it since
 * M04: canAuthenticate() uses status and deleted_at only. Account state lives
 * in `status`, so dropping the column loses nothing.
 */
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  const cols = (await qi.describeTable(TABLE)) as Record<string, unknown>;
  if ('is_active' in cols) await qi.removeColumn(TABLE, 'is_active');
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  const cols = (await qi.describeTable(TABLE)) as Record<string, unknown>;
  if (!('is_active' in cols)) {
    await qi.addColumn(TABLE, 'is_active', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true });
  }
  await qi.sequelize.query(`UPDATE users SET is_active = 0 WHERE deleted_at IS NOT NULL OR status <> 'active'`);
};
