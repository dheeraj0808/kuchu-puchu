import { DataTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

import {
  TABLE_OPTIONS,
  createdAtColumn,
  dropTableIfExists,
  ensureIndexes,
  tableExists,
  updatedAtColumn,
  uuidPrimaryKey,
} from './helpers';

const TABLE = 'dating_preferences';

export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) {
    await qi.createTable(
      TABLE,
      {
        id: uuidPrimaryKey(),
        user_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        min_age: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
        max_age: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
        // JSON array of gender values; validated in the application layer.
        preferred_genders: { type: DataTypes.JSON, allowNull: false },
        max_distance_km: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false },
        // VARCHAR rather than ENUM so new intents do not need a schema change.
        relationship_intent: { type: DataTypes.STRING(32), allowNull: false },
        created_at: createdAtColumn(),
        updated_at: updatedAtColumn(),
      },
      TABLE_OPTIONS,
    );
  }

  await ensureIndexes(qi, TABLE, [
    { name: 'dating_preferences_user_id_unique', fields: ['user_id'], unique: true },
    { name: 'dating_preferences_intent_idx', fields: ['relationship_intent'] },
  ]);
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await dropTableIfExists(qi, TABLE);
};
