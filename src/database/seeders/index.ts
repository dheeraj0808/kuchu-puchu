import type { QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

/**
 * Seed data (catalogue rows, reference data). Run with `npm run seed`.
 *
 * Each seeder runs once and is recorded in `sequelize_seed_meta`, like
 * migrations are in `sequelize_meta`. Seeders must be idempotent anyway
 * (insert only what is missing, never overwrite), so re-running on a copy of
 * another environment is safe. Name them `<yyyymmddhhmmss>-<what>`, add the
 * file next to this one, and append it below.
 *
 * The interests catalogue is seeded by migration 20261001000004-seed-interests,
 * which stays as it is.
 */
export interface SeederDefinition {
  name: string;
  up: MigrationFn<QueryInterface>;
  down?: MigrationFn<QueryInterface>;
}

/** Ordered list of seeders. Append new seeders at the end. */
export const seeders: SeederDefinition[] = [];
