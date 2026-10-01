import type { QueryInterface, Sequelize } from 'sequelize';
import type { MigrationFn } from 'umzug';

import * as interests from './20261009000001-interests';
import * as prompts from './20261009000002-prompts';
import * as appSettings from './20261009000003-app-settings';

/**
 * Seed data (catalogue rows, reference data). Run with `npm run seed`.
 *
 * Since M08 every seeder runs on every `npm run seed` (no run-once record):
 * each one upserts, so re-running is safe and picks up edits to the seed
 * lists. Catalogue seeders upsert by their natural key; the settings seeder
 * only inserts missing keys, so admin changes are never overwritten. Name
 * them `<yyyymmddhhmmss>-<what>`, add the file next to this one, and append
 * it below.
 *
 * Migration 20261001000004-seed-interests (the first catalogue) stays as it is.
 */
export interface SeederDefinition {
  name: string;
  up: MigrationFn<QueryInterface>;
  down?: MigrationFn<QueryInterface>;
}

/** Ordered list of seeders. Append new seeders at the end. */
export const seeders: SeederDefinition[] = [
  { name: '20261009000001-interests', ...interests },
  { name: '20261009000002-prompts', ...prompts },
  { name: '20261009000003-app-settings', ...appSettings },
];

/** Runs every seeder in order. Each one upserts, so this is safe to repeat. */
export async function runSeeders(sequelize: Sequelize): Promise<void> {
  const context = sequelize.getQueryInterface();
  for (const seeder of seeders) await seeder.up({ name: seeder.name, path: undefined, context });
}
