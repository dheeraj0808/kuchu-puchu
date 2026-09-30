import { DataTypes, Sequelize, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

import {
  TABLE_OPTIONS_0900,
  createdAtColumn,
  dropTableIfExists,
  ensureIndexes,
  tableExists,
  uuidColumn,
} from './helpers';

const TABLE = 'outbox_events';

/** Guide M03: one row per domain event. BIGINT id (§4.2), no updated_at. */
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) {
    await qi.createTable(
      TABLE,
      {
        id: {
          type: DataTypes.BIGINT.UNSIGNED,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        // VARCHAR validated in code, so a new event type needs no migration (§4.2).
        event_type: { type: DataTypes.STRING(64), allowNull: false },
        aggregate_id: uuidColumn(),
        payload: { type: DataTypes.JSON, allowNull: false },
        status: {
          type: DataTypes.ENUM('pending', 'done', 'failed'),
          allowNull: false,
          defaultValue: 'pending',
        },
        attempts: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
        available_at: {
          type: DataTypes.DATE(3),
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP(3)'),
        },
        last_error: { type: DataTypes.STRING(500), allowNull: true },
        created_at: createdAtColumn(),
      },
      TABLE_OPTIONS_0900,
    );
  }

  // The relay's SELECT and the cleanup's DELETE both range-scan this index.
  await ensureIndexes(qi, TABLE, [
    { name: 'outbox_events_status_available_idx', fields: ['status', 'available_at'] },
  ]);
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await dropTableIfExists(qi, TABLE);
};
