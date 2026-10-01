import { randomUUID } from 'node:crypto';

import { QueryTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

import { INTEREST_SEED } from '../../interests/interests.seed';

/**
 * Upserts INTEREST_SEED by slug: missing slugs are inserted (active), existing
 * ones get the list's name, category, icon and order. is_active of an
 * existing row is never touched and nothing is deleted. Safe to re-run.
 */
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  const now = new Date();
  let inserted = 0;
  let updated = 0;
  for (const [index, i] of INTEREST_SEED.entries()) {
    const sortOrder = (index + 1) * 10;
    const [row] = await qi.sequelize.query<{ id: string; name: string; category: string; icon: string; sort_order: number }>(
      'SELECT id, name, category, icon, sort_order FROM interests WHERE slug = :slug',
      { replacements: { slug: i.slug }, type: QueryTypes.SELECT },
    );
    if (!row) {
      await qi.bulkInsert('interests', [
        { id: randomUUID(), name: i.name, slug: i.slug, category: i.category, icon: i.icon, sort_order: sortOrder, is_active: true, created_at: now, updated_at: now },
      ]);
      inserted++;
    } else if (row.name !== i.name || row.category !== i.category || row.icon !== i.icon || Number(row.sort_order) !== sortOrder) {
      await qi.sequelize.query(
        'UPDATE interests SET name = :name, category = :category, icon = :icon, sort_order = :sortOrder, updated_at = :now WHERE id = :id',
        { replacements: { name: i.name, category: i.category, icon: i.icon, sortOrder, now, id: row.id } },
      );
      updated++;
    }
  }
  console.log(`[M08] interests seeder: ${inserted} inserted, ${updated} updated, ${INTEREST_SEED.length - inserted - updated} unchanged`);
};
