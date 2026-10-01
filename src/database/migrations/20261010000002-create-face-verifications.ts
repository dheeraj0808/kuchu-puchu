import { DataTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

import { TABLE_OPTIONS_0900, createdAtColumn, ensureIndexes, updatedAtColumn, uuidColumn } from './helpers';

const TABLE = 'face_verifications';

/** M11: face_verifications exactly as guide §8 M11 (+ standard columns), one row per attempt. */
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  if (!(await qi.tableExists(TABLE))) {
    await qi.createTable(
      TABLE,
      {
        id: uuidColumn({ primaryKey: true }),
        user_id: uuidColumn({ references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'CASCADE' }),
        provider: { type: DataTypes.STRING(30), allowNull: false },
        provider_session_id: { type: DataTypes.STRING(100), allowNull: false },
        status: {
          type: DataTypes.ENUM('created', 'processing', 'approved', 'pending_review', 'rejected', 'expired'),
          allowNull: false,
          defaultValue: 'created',
        },
        liveness_score: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
        selfie_key: { type: DataTypes.STRING(200), allowNull: true },
        rejection_reason: { type: DataTypes.STRING(40), allowNull: true },
        reviewer_id: uuidColumn({ allowNull: true }),
        reviewed_at: { type: DataTypes.DATE(3), allowNull: true },
        consent_version: { type: DataTypes.STRING(20), allowNull: false },
        consented_at: { type: DataTypes.DATE(3), allowNull: false },
        decided_at: { type: DataTypes.DATE(3), allowNull: true },
        created_at: createdAtColumn(),
        updated_at: updatedAtColumn(),
      },
      TABLE_OPTIONS_0900,
    );
  }
  await ensureIndexes(qi, TABLE, [
    { name: 'face_verifications_user_created_idx', fields: ['user_id', 'created_at'] },
    // The M15 review queue: pending_review oldest first.
    { name: 'face_verifications_status_created_idx', fields: ['status', 'created_at'] },
  ]);
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await qi.dropTable(TABLE);
};
