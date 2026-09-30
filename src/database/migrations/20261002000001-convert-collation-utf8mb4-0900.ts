import { QueryTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

/** Guide §4.2: InnoDB, utf8mb4, utf8mb4_0900_ai_ci. */
const TARGET = 'utf8mb4_0900_ai_ci';
/** What the earlier migrations created. Only used by `down` (dev only). */
const PREVIOUS = 'utf8mb4_unicode_ci';

const IDENTIFIER = /^[A-Za-z0-9_]+$/;

function quoteIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`Unexpected identifier "${name}"`);
  return `\`${name}\``;
}

/**
 * Converts the database default and every table (and every text column) that
 * is not yet in `collation`. Idempotent: already-converted tables are skipped.
 *
 * Runs on one pinned connection with FOREIGN_KEY_CHECKS off, because MySQL
 * rejects changing the collation of a foreign-key column while the column it
 * references still has the old one. Checks are turned back on afterwards.
 */
async function convertTo(qi: QueryInterface, collation: string): Promise<void> {
  const sequelize = qi.sequelize;
  await sequelize.transaction(async (transaction) => {
    const run = (sql: string): Promise<unknown> => sequelize.query(sql, { transaction });
    await run('SET FOREIGN_KEY_CHECKS = 0');
    try {
      const [{ db }] = await sequelize.query<{ db: string }>('SELECT DATABASE() AS db', {
        type: QueryTypes.SELECT,
        transaction,
      });
      await run(`ALTER DATABASE ${quoteIdentifier(db)} CHARACTER SET utf8mb4 COLLATE ${collation}`);

      const tables = await sequelize.query<{ name: string }>(
        `SELECT TABLE_NAME AS name FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_COLLATION <> :collation
         UNION
         SELECT DISTINCT c.TABLE_NAME AS name FROM information_schema.COLUMNS c
           JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
          WHERE c.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE'
            AND c.COLLATION_NAME IS NOT NULL AND c.COLLATION_NAME <> :collation`,
        { type: QueryTypes.SELECT, replacements: { collation }, transaction },
      );
      for (const { name } of tables) {
        await run(`ALTER TABLE ${quoteIdentifier(name)} CONVERT TO CHARACTER SET utf8mb4 COLLATE ${collation}`);
      }
    } finally {
      await run('SET FOREIGN_KEY_CHECKS = 1');
    }
  });
}

export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await convertTo(qi, TARGET);
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await convertTo(qi, PREVIOUS);
};
