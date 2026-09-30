import { DataTypes, QueryTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

import { toE164 } from '../../auth/utils/identifier.util';
import { ensureIndexes } from './helpers';

const TABLE = 'users';

async function columns(qi: QueryInterface): Promise<Record<string, unknown>> {
  return (await qi.describeTable(TABLE)) as Record<string, unknown>;
}

/**
 * M04: one status field (guide §8 M04).
 * - status gains `banned`; is_banned is folded into it and dropped:
 *   is_banned = 1 → banned; else deleted_at set → deactivated; else the
 *   current status is kept (an existing suspension is never lifted here).
 * - adds suspended_until, discovery_restricted_at, last_active_at;
 * - phone becomes VARCHAR(16) (E.164 max), refused if a stored value is longer;
 * - adds the (last_active_at) index.
 */
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  const seq = qi.sequelize;
  await seq.query(
    `ALTER TABLE users MODIFY COLUMN status ENUM('active','suspended','banned','deactivated') NOT NULL DEFAULT 'active'`,
  );

  const cols = await columns(qi);
  if ('is_banned' in cols) {
    await seq.query(`UPDATE users SET status = 'banned' WHERE is_banned = 1`);
    await seq.query(`UPDATE users SET status = 'deactivated' WHERE is_banned = 0 AND deleted_at IS NOT NULL`);
    await qi.removeColumn(TABLE, 'is_banned');
  }
  for (const name of ['suspended_until', 'discovery_restricted_at', 'last_active_at']) {
    if (!(name in cols)) {
      await qi.addColumn(TABLE, name, { type: DataTypes.DATE(3), allowNull: true });
    }
  }

  const [{ longest }] = await seq.query<{ longest: number | null }>(
    'SELECT MAX(CHAR_LENGTH(phone)) AS longest FROM users',
    { type: QueryTypes.SELECT },
  );
  if (longest !== null && Number(longest) > 16) {
    throw new Error('users.phone has values longer than 16 characters; normalise them to E.164 before migrating');
  }
  // Lookups now normalise strictly; a stored phone that is not valid E.164 could never sign in again.
  const phones = await seq.query<{ phone: string }>('SELECT phone FROM users WHERE phone IS NOT NULL', {
    type: QueryTypes.SELECT,
  });
  const invalid = phones.filter((r) => toE164(r.phone) !== r.phone).length;
  if (invalid > 0) {
    throw new Error(`${invalid} users.phone values are not valid E.164; fix them before migrating`);
  }
  await seq.query('ALTER TABLE users MODIFY COLUMN phone VARCHAR(16) NULL');

  await ensureIndexes(qi, TABLE, [{ name: 'users_last_active_at_idx', fields: ['last_active_at'] }]);
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  const seq = qi.sequelize;
  const cols = await columns(qi);
  if (!('is_banned' in cols)) {
    await qi.addColumn(TABLE, 'is_banned', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  }
  await seq.query(`UPDATE users SET is_banned = 1, status = 'deactivated' WHERE status = 'banned'`);
  await seq.query(
    `ALTER TABLE users MODIFY COLUMN status ENUM('active','suspended','deactivated') NOT NULL DEFAULT 'active'`,
  );
  await seq.query('ALTER TABLE users MODIFY COLUMN phone VARCHAR(20) NULL');
  for (const name of ['suspended_until', 'discovery_restricted_at', 'last_active_at']) {
    if (name in cols) await qi.removeColumn(TABLE, name);
  }
};
