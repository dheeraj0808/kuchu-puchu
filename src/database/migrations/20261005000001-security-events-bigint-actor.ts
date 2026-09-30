import { QueryTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

import { ensureIndexes, UUID_COLUMN_TYPE } from './helpers';

const TABLE = 'security_events';
const NEXT = 'security_events_next';
const OLD = 'security_events_old';

/**
 * M05: security_events as the spec defines it: BIGINT UNSIGNED AUTO_INCREMENT
 * id, actor_user_id, user_agent VARCHAR(255), no updated_at, indexes
 * (user_id, created_at) and (event_type, created_at).
 *
 * The id type changes, so the table is rebuilt: rows are copied in
 * created_at order and get new sequential ids (nothing references them),
 * the tables are swapped in one atomic RENAME, rows written to the old table
 * in between are copied after it, and the old table is dropped only when
 * every row is accounted for. A run that stopped half-way can be rerun.
 * user_agent values longer than 255 characters are cut to 255.
 */
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  const seq = qi.sequelize;
  const exists = async (t: string): Promise<boolean> => qi.tableExists(t);

  // Recovery: a previous run stopped between the swap steps.
  if (!(await exists(TABLE)) && (await exists(NEXT)))
    await seq.query(`RENAME TABLE ${NEXT} TO ${TABLE}`);
  const cols = (await qi.describeTable(TABLE)) as Record<
    string,
    { type: string }
  >;

  if (!cols.id.type.toUpperCase().startsWith('BIGINT')) {
    await seq.query(`DROP TABLE IF EXISTS ${NEXT}`);
    await seq.query(`DROP TABLE IF EXISTS ${OLD}`);
    // legacy_id keeps the old UUID only while copying, so late rows can be found and nothing is copied twice.
    await seq.query(`
      CREATE TABLE ${NEXT} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id ${UUID_COLUMN_TYPE} NULL,
        actor_user_id ${UUID_COLUMN_TYPE} NULL,
        event_type VARCHAR(64) NOT NULL,
        ip_address VARCHAR(45) NULL,
        user_agent VARCHAR(255) NULL,
        metadata JSON NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        legacy_id ${UUID_COLUMN_TYPE} NULL,
        UNIQUE KEY security_events_legacy_id_unique (legacy_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    const copy = (from: string): Promise<unknown> =>
      seq.query(`
        INSERT INTO ${NEXT} (user_id, event_type, ip_address, user_agent, metadata, created_at, legacy_id)
        SELECT o.user_id, o.event_type, o.ip_address, LEFT(o.user_agent, 255), o.metadata, o.created_at, o.id
          FROM ${from} o LEFT JOIN ${NEXT} n ON n.legacy_id = o.id
         WHERE n.id IS NULL
         ORDER BY o.created_at, o.id`);
    await copy(TABLE);
    // One atomic swap: writers never see a missing table.
    await seq.query(`RENAME TABLE ${TABLE} TO ${OLD}, ${NEXT} TO ${TABLE}`);
    await finishSwap(qi);
  } else if ('legacy_id' in cols) {
    // Recovery: a previous run swapped the tables but did not finish.
    await finishSwap(qi);
  } else {
    if (!('actor_user_id' in cols)) {
      await seq.query(
        `ALTER TABLE ${TABLE} ADD COLUMN actor_user_id ${UUID_COLUMN_TYPE} NULL AFTER user_id`,
      );
    }
    await seq.query(
      `UPDATE ${TABLE} SET user_agent = LEFT(user_agent, 255) WHERE CHAR_LENGTH(user_agent) > 255`,
    );
    await seq.query(
      `ALTER TABLE ${TABLE} MODIFY COLUMN user_agent VARCHAR(255) NULL`,
    );
  }

  await ensureIndexes(qi, TABLE, [
    {
      name: 'security_events_user_created_idx',
      fields: ['user_id', 'created_at'],
    },
    {
      name: 'security_events_type_created_idx',
      fields: ['event_type', 'created_at'],
    },
    // Retention deletes by age across all non-admin types.
    { name: 'security_events_created_at_idx', fields: ['created_at'] },
  ]);
};

/** After the swap: copy late rows, verify nothing is missing, then drop the helper column and the old table. */
async function finishSwap(qi: QueryInterface): Promise<void> {
  const seq = qi.sequelize;
  if (await qi.tableExists(OLD)) {
    // Rows the old table received between the copy and the swap.
    await seq.query(`
        INSERT INTO ${TABLE} (user_id, event_type, ip_address, user_agent, metadata, created_at, legacy_id)
        SELECT o.user_id, o.event_type, o.ip_address, LEFT(o.user_agent, 255), o.metadata, o.created_at, o.id
          FROM ${OLD} o LEFT JOIN ${TABLE} n ON n.legacy_id = o.id
         WHERE n.id IS NULL
         ORDER BY o.created_at, o.id`);
    const [{ missing }] = await seq.query<{ missing: number }>(
      `SELECT COUNT(*) AS missing FROM ${OLD} o LEFT JOIN ${TABLE} n ON n.legacy_id = o.id WHERE n.id IS NULL`,
      { type: QueryTypes.SELECT },
    );
    if (Number(missing) !== 0)
      throw new Error(
        `security_events copy is incomplete (${missing} rows); ${OLD} is kept`,
      );
    await seq.query(`DROP TABLE ${OLD}`);
  }
  const cols = (await qi.describeTable(TABLE)) as Record<string, unknown>;
  if ('legacy_id' in cols) {
    await seq.query(
      `ALTER TABLE ${TABLE} DROP INDEX security_events_legacy_id_unique, DROP COLUMN legacy_id`,
    );
  }
  const [{ fks }] = await seq.query<{ fks: number }>(
    `SELECT COUNT(*) AS fks FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${TABLE}' AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
    { type: QueryTypes.SELECT },
  );
  if (Number(fks) === 0) {
    await seq.query(`
      ALTER TABLE ${TABLE}
        ADD CONSTRAINT security_events_user_id_fk FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE`);
  }
}

/** Forward-only in production. Down keeps the BIGINT id and only removes actor_user_id. */
export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  const cols = (await qi.describeTable(TABLE)) as Record<string, unknown>;
  if ('actor_user_id' in cols) await qi.removeColumn(TABLE, 'actor_user_id');
};
