import { DataTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

const TABLE = 'profiles';

/** M11 (column from the M09 spec): profiles.face_verified_at DATETIME(3) NULL, set when the live selfie is approved. */
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  const cols = (await qi.describeTable(TABLE)) as Record<string, unknown>;
  if (!('face_verified_at' in cols)) {
    await qi.addColumn(TABLE, 'face_verified_at', { type: DataTypes.DATE(3), allowNull: true });
  }
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await qi.removeColumn(TABLE, 'face_verified_at');
};
