import { DataTypes, QueryTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

import { ensureIndexes } from './helpers';

const TABLE = 'interests';

/**
 * M08: interests exactly as guide §8 M08: name / slug VARCHAR(50) (slug
 * unique), category VARCHAR(30), icon VARCHAR(50), is_active, sort_order
 * SMALLINT. Existing rows get category "other", icon "sparkles" and order 0
 * until the interests seeder fills them in. The (is_active, name) index is
 * replaced by (is_active, sort_order), the catalogue's read order. Prints how
 * many rows were changed.
 */
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  const cols = (await qi.describeTable(TABLE)) as Record<string, unknown>;
  const [{ tooLong }] = await qi.sequelize.query<{ tooLong: number }>(
    `SELECT COUNT(*) AS tooLong FROM ${TABLE} WHERE CHAR_LENGTH(name) > 50 OR CHAR_LENGTH(slug) > 50`,
    { type: QueryTypes.SELECT },
  );
  if (Number(tooLong) > 0) throw new Error(`[M08] ${TABLE}: ${Number(tooLong)} rows have a name or slug over 50 characters; fix them first`);

  await qi.changeColumn(TABLE, 'name', { type: DataTypes.STRING(50), allowNull: false });
  await qi.changeColumn(TABLE, 'slug', { type: DataTypes.STRING(50), allowNull: false });
  if (!('category' in cols)) await qi.addColumn(TABLE, 'category', { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'other' });
  if (!('icon' in cols)) await qi.addColumn(TABLE, 'icon', { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'sparkles' });
  if (!('sort_order' in cols)) await qi.addColumn(TABLE, 'sort_order', { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 });

  const indexes = (await qi.showIndex(TABLE)) as Array<{ name: string }>;
  if (indexes.some((i) => i.name === 'interests_active_name_idx')) await qi.removeIndex(TABLE, 'interests_active_name_idx');
  await ensureIndexes(qi, TABLE, [{ name: 'interests_active_sort_idx', fields: ['is_active', 'sort_order'] }]);

  const [{ n }] = await qi.sequelize.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${TABLE}`, { type: QueryTypes.SELECT });
  console.log(`[M08] ${TABLE}: aligned the table; ${Number(n)} existing rows got the default category, icon and order`);
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  const indexes = (await qi.showIndex(TABLE)) as Array<{ name: string }>;
  if (indexes.some((i) => i.name === 'interests_active_sort_idx')) await qi.removeIndex(TABLE, 'interests_active_sort_idx');
  await ensureIndexes(qi, TABLE, [{ name: 'interests_active_name_idx', fields: ['is_active', 'name'] }]);
  for (const col of ['sort_order', 'icon', 'category']) await qi.removeColumn(TABLE, col);
  await qi.changeColumn(TABLE, 'name', { type: DataTypes.STRING(64), allowNull: false });
  await qi.changeColumn(TABLE, 'slug', { type: DataTypes.STRING(64), allowNull: false });
};
