import { QueryTypes, Sequelize } from 'sequelize';

import { TABLE_OPTIONS_0900, createdAtColumn, uuidColumn } from '../../src/database/migrations/helpers';
import { assertSupportedServer } from '../../src/database/server-version';

/**
 * Checks the migrated test database against guide §4.2 and the UUID column
 * rule: CHAR(36) UUID columns are utf8mb4_bin, everything else is
 * utf8mb4_0900_ai_ci. Reads information_schema only.
 */
describe('Database schema (MySQL 8.4)', () => {
  let sequelize: Sequelize;
  const select = <T extends object>(sql: string): Promise<T[]> => sequelize.query<T>(sql, { type: QueryTypes.SELECT });

  beforeAll(() => {
    sequelize = new Sequelize({
      dialect: 'mysql',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 3306),
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      logging: false,
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('runs on the test database of a MySQL ≥ 8.4 server', async () => {
    const [{ db, version }] = await select<{ db: string; version: string }>('SELECT DATABASE() AS db, VERSION() AS version');
    expect(db).toMatch(/_test$/);
    expect(() => assertSupportedServer(version)).not.toThrow();
  });

  it('uses utf8mb4_0900_ai_ci as the database and table default', async () => {
    const [{ collation }] = await select<{ collation: string }>(
      'SELECT DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()',
    );
    expect(collation).toBe('utf8mb4_0900_ai_ci');
    const tables = await select<{ name: string; collation: string }>(
      `SELECT TABLE_NAME AS name, TABLE_COLLATION AS collation FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`,
    );
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.filter((t) => t.collation !== 'utf8mb4_0900_ai_ci')).toEqual([]);
  });

  it('has no UUID (CHAR(36)) column that is not utf8mb4_bin', async () => {
    const uuidColumns = await select<{ col: string; collation: string }>(
      `SELECT CONCAT(TABLE_NAME, '.', COLUMN_NAME) AS col, COLLATION_NAME AS collation FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE = 'char' AND CHARACTER_MAXIMUM_LENGTH = 36`,
    );
    expect(uuidColumns.map((c) => c.col)).toEqual(expect.arrayContaining(['users.id', 'sessions.user_id']));
    expect(uuidColumns.filter((c) => c.collation !== 'utf8mb4_bin')).toEqual([]);
  });

  it('has every other text column in utf8mb4_0900_ai_ci', async () => {
    const others = await select<{ col: string; collation: string }>(
      `SELECT CONCAT(TABLE_NAME, '.', COLUMN_NAME) AS col, COLLATION_NAME AS collation FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND COLLATION_NAME IS NOT NULL
          AND NOT (DATA_TYPE = 'char' AND CHARACTER_MAXIMUM_LENGTH = 36)`,
    );
    expect(others.length).toBeGreaterThan(0);
    expect(others.filter((c) => c.collation !== 'utf8mb4_0900_ai_ci')).toEqual([]);
  });

  it('keeps foreign keys intact after the conversion', async () => {
    const [{ n }] = await select<{ n: number }>(
      'SELECT COUNT(*) AS n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()',
    );
    // M06 dropped otp_verifications.user_id (and its FK) to match the spec.
    expect(Number(n)).toBeGreaterThanOrEqual(6);
  });

  it('creates future UUID columns as utf8mb4_bin through the shared helper', async () => {
    const qi = sequelize.getQueryInterface();
    const table = 'zz_schema_test_uuid_helper';
    await qi.dropTable(table).catch(() => undefined);
    try {
      await qi.createTable(
        table,
        { id: uuidColumn({ primaryKey: true }), user_id: uuidColumn({ allowNull: true }), created_at: createdAtColumn() },
        TABLE_OPTIONS_0900,
      );
      const cols = await select<{ name: string; type: string; collation: string; nullable: string }>(
        `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, COLLATION_NAME AS collation, IS_NULLABLE AS nullable
           FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME IN ('id', 'user_id')
          ORDER BY COLUMN_NAME`,
      );
      expect(cols).toEqual([
        { name: 'id', type: 'char(36)', collation: 'utf8mb4_bin', nullable: 'NO' },
        { name: 'user_id', type: 'char(36)', collation: 'utf8mb4_bin', nullable: 'YES' },
      ]);
    } finally {
      await qi.dropTable(table);
    }
  });
});
