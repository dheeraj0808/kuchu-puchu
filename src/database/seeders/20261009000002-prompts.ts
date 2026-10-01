import { randomUUID } from 'node:crypto';

import { QueryTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

import { PROMPT_SEED } from '../../catalog/prompts.seed';

/** Upserts PROMPT_SEED by text (category and order); is_active only on insert; nothing deleted. Safe to re-run. */
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  const now = new Date();
  let inserted = 0;
  let updated = 0;
  for (const [index, p] of PROMPT_SEED.entries()) {
    const sortOrder = (index + 1) * 10;
    const [row] = await qi.sequelize.query<{ id: string; category: string; sort_order: number }>(
      'SELECT id, category, sort_order FROM prompts WHERE text = :text',
      { replacements: { text: p.text }, type: QueryTypes.SELECT },
    );
    if (!row) {
      await qi.bulkInsert('prompts', [
        { id: randomUUID(), text: p.text, category: p.category, sort_order: sortOrder, is_active: true, created_at: now, updated_at: now },
      ]);
      inserted++;
    } else if (row.category !== p.category || Number(row.sort_order) !== sortOrder) {
      await qi.sequelize.query('UPDATE prompts SET category = :category, sort_order = :sortOrder, updated_at = :now WHERE id = :id', {
        replacements: { category: p.category, sortOrder, now, id: row.id },
      });
      updated++;
    }
  }
  console.log(`[M08] prompts seeder: ${inserted} inserted, ${updated} updated, ${PROMPT_SEED.length - inserted - updated} unchanged`);
};
