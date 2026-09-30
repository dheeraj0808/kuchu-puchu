import { randomUUID } from 'node:crypto';

import { QueryTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

import { INTEREST_SEED } from '../../interests/interests.seed';

const TABLE = 'interests';

/** Inserts only slugs that are missing; never updates or removes existing rows. */
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  const existing = await qi.sequelize.query<{ slug: string }>(`SELECT slug FROM \`${TABLE}\``, {
    type: QueryTypes.SELECT,
  });
  const have = new Set(existing.map((r) => r.slug));
  const now = new Date();
  const rows = INTEREST_SEED.filter((i) => !have.has(i.slug)).map((i) => ({
    id: randomUUID(),
    name: i.name,
    slug: i.slug,
    is_active: true,
    created_at: now,
    updated_at: now,
  }));
  if (rows.length > 0) await qi.bulkInsert(TABLE, rows);
};

/** Removes seeded slugs that no profile references. */
export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  const slugs = INTEREST_SEED.map((i) => i.slug);
  await qi.sequelize.query(
    `DELETE i FROM \`${TABLE}\` i LEFT JOIN profile_interests pi ON pi.interest_id = i.id
     WHERE pi.id IS NULL AND i.slug IN (:slugs)`,
    { replacements: { slugs } },
  );
};
