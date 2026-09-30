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

const TABLE = 'profile_interests';

export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) {
    await qi.createTable(
      TABLE,
      {
        id: uuidPrimaryKey(),
        profile_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'profiles', key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        interest_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'interests', key: 'id' },
          // Interests are deactivated, never deleted while referenced.
          onDelete: 'RESTRICT',
          onUpdate: 'CASCADE',
        },
        created_at: createdAtColumn(),
        updated_at: updatedAtColumn(),
      },
      TABLE_OPTIONS,
    );
  }

  await ensureIndexes(qi, TABLE, [
    {
      name: 'profile_interests_profile_interest_unique',
      fields: ['profile_id', 'interest_id'],
      unique: true,
    },
    // Reverse lookup (profiles by interest) for future discovery.
    { name: 'profile_interests_interest_id_idx', fields: ['interest_id'] },
  ]);
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await dropTableIfExists(qi, TABLE);
};
