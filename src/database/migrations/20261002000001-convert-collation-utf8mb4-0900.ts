import { QueryTypes, type QueryInterface, type Transaction } from 'sequelize';
import type { MigrationFn } from 'umzug';

import { UUID_COLUMN_TYPE } from './helpers';

/** Guide §4.2: InnoDB, utf8mb4, utf8mb4_0900_ai_ci. */
const TARGET = 'utf8mb4_0900_ai_ci';
/** What the earlier migrations created. Only used by `down` (dev only). */
const PREVIOUS = 'utf8mb4_unicode_ci';
/** UUID id / foreign-key columns (CHAR(36)) always stay binary. */
const UUID_COLLATION = 'utf8mb4_bin';

const IDENTIFIER = /^[A-Za-z0-9_]+$/;

function quoteIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`Unexpected identifier "${name}"`);
  return `\`${name}\``;
}

interface UuidColumn {
  tableName: string;
  columnName: string;
  isNullable: 'YES' | 'NO';
  columnDefault: string | null;
  columnComment: string;
}

/**
 * Converts the database default, every table and every text column to
 * `collation`, except CHAR(36) UUID columns, which are (re)set to utf8mb4_bin.
 * Idempotent: tables that already match are skipped.
 *
 * Runs on one pinned connection with FOREIGN_KEY_CHECKS off, because MySQL
 * rejects changing the collation of a foreign-key column while the column it
 * references still has a different one. Checks are turned back on afterwards.
 */
async function convertTo(qi: QueryInterface, collation: string): Promise<void> {
  const sequelize = qi.sequelize;
  await sequelize.transaction(async (transaction: Transaction) => {
    const run = (sql: string): Promise<unknown> => sequelize.query(sql, { transaction });
    const select = <T extends object>(sql: string): Promise<T[]> =>
      sequelize.query<T>(sql, {
        type: QueryTypes.SELECT,
        replacements: { collation, uuidCollation: UUID_COLLATION },
        transaction,
      });

    await run('SET FOREIGN_KEY_CHECKS = 0');
    try {
      const [{ db }] = await select<{ db: string }>('SELECT DATABASE() AS db');
      await run(`ALTER DATABASE ${quoteIdentifier(db)} CHARACTER SET utf8mb4 COLLATE ${collation}`);

      const uuidColumns = await select<UuidColumn>(
        `SELECT c.TABLE_NAME AS tableName, c.COLUMN_NAME AS columnName, c.IS_NULLABLE AS isNullable,
                c.COLUMN_DEFAULT AS columnDefault, c.COLUMN_COMMENT AS columnComment
           FROM information_schema.COLUMNS c
           JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
          WHERE c.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE'
            AND c.DATA_TYPE = 'char' AND c.CHARACTER_MAXIMUM_LENGTH = 36`,
      );

      const needsWork = await select<{ tableName: string }>(
        `SELECT TABLE_NAME AS tableName FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_COLLATION <> :collation
         UNION
         SELECT DISTINCT c.TABLE_NAME FROM information_schema.COLUMNS c
           JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
          WHERE c.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE' AND c.COLLATION_NAME IS NOT NULL
            AND c.COLLATION_NAME <> IF(c.DATA_TYPE = 'char' AND c.CHARACTER_MAXIMUM_LENGTH = 36, :uuidCollation, :collation)`,
      );

      for (const { tableName } of needsWork) {
        const table = quoteIdentifier(tableName);
        await run(`ALTER TABLE ${table} CONVERT TO CHARACTER SET utf8mb4 COLLATE ${collation}`);
        // CONVERT TO changes every text column; put the UUID columns back to binary.
        const restores = uuidColumns
          .filter((c) => c.tableName === tableName)
          .map((c) => {
            const nullability = c.isNullable === 'YES' ? 'NULL' : 'NOT NULL';
            const dflt = c.columnDefault === null ? '' : ` DEFAULT ${sequelize.escape(c.columnDefault)}`;
            const comment = c.columnComment ? ` COMMENT ${sequelize.escape(c.columnComment)}` : '';
            return `MODIFY ${quoteIdentifier(c.columnName)} ${UUID_COLUMN_TYPE} ${nullability}${dflt}${comment}`;
          });
        if (restores.length > 0) {
          await run(`ALTER TABLE ${table} ${restores.join(', ')}`);
        }
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
