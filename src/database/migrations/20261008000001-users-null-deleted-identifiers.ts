import { QueryTypes, type QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

/**
 * M07 (closes the M04 deferral): account deletion always nulls email and
 * phone. Rows soft-deleted before that rule still hold their identifiers, so
 * the same phone or email could never sign up again. This nulls them once and
 * prints how many rows changed. Idempotent: a second run changes 0 rows.
 */
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  const [{ n }] = await qi.sequelize.query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NOT NULL AND (email IS NOT NULL OR phone IS NOT NULL)',
    { type: QueryTypes.SELECT },
  );
  await qi.sequelize.query(
    `UPDATE users SET email = NULL, phone = NULL, email_verified_at = NULL, phone_verified_at = NULL
      WHERE deleted_at IS NOT NULL AND (email IS NOT NULL OR phone IS NOT NULL)`,
  );
  console.log(`[M07] users: nulled email and phone on ${Number(n)} soft-deleted rows`);
};

/** Nothing to restore: the identifiers are gone on purpose. */
export const down: MigrationFn<QueryInterface> = async () => undefined;
