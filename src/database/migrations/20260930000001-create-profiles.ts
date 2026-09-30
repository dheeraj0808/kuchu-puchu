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

const TABLE = 'profiles';

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
        // Nullable so account deletion can scrub them; required by the API.
        display_name: { type: DataTypes.STRING(50), allowNull: true },
        date_of_birth: { type: DataTypes.DATEONLY, allowNull: true },
        gender: { type: DataTypes.ENUM('woman', 'man', 'non_binary', 'other'), allowNull: true },
        bio: { type: DataTypes.STRING(500), allowNull: true },
        occupation: { type: DataTypes.STRING(100), allowNull: true },
        education: { type: DataTypes.STRING(100), allowNull: true },
        city: { type: DataTypes.STRING(100), allowNull: true },
        state: { type: DataTypes.STRING(100), allowNull: true },
        country: { type: DataTypes.CHAR(2), allowNull: true },
        latitude: { type: DataTypes.DECIMAL(9, 6), allowNull: true },
        longitude: { type: DataTypes.DECIMAL(9, 6), allowNull: true },
        location_updated_at: { type: DataTypes.DATE(3), allowNull: true },
        is_discoverable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        profile_visibility: {
          type: DataTypes.ENUM('public', 'matches_only', 'hidden'),
          allowNull: false,
          defaultValue: 'public',
        },
        profile_completion: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
        created_at: createdAtColumn(),
        updated_at: updatedAtColumn(),
        deleted_at: { type: DataTypes.DATE(3), allowNull: true },
      },
      TABLE_OPTIONS,
    );
  }

  await ensureIndexes(qi, TABLE, [
    { name: 'profiles_user_id_unique', fields: ['user_id'], unique: true },
    // Future discovery filters.
    { name: 'profiles_discoverable_idx', fields: ['is_discoverable', 'profile_visibility', 'deleted_at'] },
    { name: 'profiles_location_idx', fields: ['country', 'state', 'city'] },
    { name: 'profiles_coordinates_idx', fields: ['latitude', 'longitude'] },
    { name: 'profiles_date_of_birth_idx', fields: ['date_of_birth'] },
    { name: 'profiles_deleted_at_idx', fields: ['deleted_at'] },
  ]);
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await dropTableIfExists(qi, TABLE);
};
