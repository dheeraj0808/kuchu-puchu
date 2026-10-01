import { DataTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

const TABLE = 'interests';

/**
 * M08 review: 20261009000001 gave `category` and `icon` placeholder defaults
 * ("other", "sparkles") so existing rows could be aligned. Every row now gets
 * its real values from the seeder, and new rows always name them, so the
 * defaults go (the spec gives none). sort_order keeps its default of 0.
 */
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await qi.changeColumn(TABLE, 'category', { type: DataTypes.STRING(30), allowNull: false });
  await qi.changeColumn(TABLE, 'icon', { type: DataTypes.STRING(50), allowNull: false });
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await qi.changeColumn(TABLE, 'category', { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'other' });
  await qi.changeColumn(TABLE, 'icon', { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'sparkles' });
};
