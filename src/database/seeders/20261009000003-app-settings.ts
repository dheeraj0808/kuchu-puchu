import { QueryTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

import { defaultSettings, SETTING_KEYS } from '../../settings/settings.registry';

/**
 * Inserts a row for every setting that has none, with the registry default.
 * Existing rows are never changed: an admin's value wins over the seed. Safe
 * to re-run.
 */
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  const existing = new Set(
    (await qi.sequelize.query<{ key: string }>('SELECT `key` FROM app_settings', { type: QueryTypes.SELECT })).map((r) => r.key),
  );
  const defaults = defaultSettings();
  const missing = SETTING_KEYS.filter((k) => !existing.has(k));
  for (const key of missing) {
    await qi.sequelize.query('INSERT INTO app_settings (`key`, value, updated_by, updated_at) VALUES (:key, CAST(:value AS JSON), NULL, NOW(3))', {
      replacements: { key, value: JSON.stringify(defaults[key]) },
    });
  }
  console.log(`[M08] app_settings seeder: ${missing.length} inserted, ${SETTING_KEYS.length - missing.length} kept`);
};
