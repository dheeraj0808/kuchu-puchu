import {
  DataTypes,
  Sequelize,
  type ModelAttributeColumnOptions,
  type QueryInterface,
  type QueryInterfaceCreateTableOptions,
} from 'sequelize';

/**
 * Used by migrations that have already run; do not change. Their tables are
 * converted by 20261002000001-convert-collation-utf8mb4-0900.
 */
export const TABLE_OPTIONS: QueryInterfaceCreateTableOptions = {
  engine: 'InnoDB',
  charset: 'utf8mb4',
  collate: 'utf8mb4_unicode_ci',
};

/** Guide §4.2 table options. Use this in every new migration. */
export const TABLE_OPTIONS_0900: QueryInterfaceCreateTableOptions = {
  engine: 'InnoDB',
  charset: 'utf8mb4',
  collate: 'utf8mb4_0900_ai_ci',
};

export const createdAtColumn = (): ModelAttributeColumnOptions => ({
  type: DataTypes.DATE(3),
  allowNull: false,
  defaultValue: Sequelize.literal('CURRENT_TIMESTAMP(3)'),
});

export const updatedAtColumn = (): ModelAttributeColumnOptions => ({
  type: DataTypes.DATE(3),
  allowNull: false,
  defaultValue: Sequelize.literal(
    'CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)',
  ),
});

export const uuidPrimaryKey = (): ModelAttributeColumnOptions => ({
  type: DataTypes.UUID,
  allowNull: false,
  primaryKey: true,
});

export async function tableExists(
  qi: QueryInterface,
  tableName: string,
): Promise<boolean> {
  return qi.tableExists(tableName);
}

function extractIndexNames(result: unknown): Set<string> {
  const names = new Set<string>();
  if (!Array.isArray(result)) return names;
  for (const row of result as unknown[]) {
    if (typeof row === 'object' && row !== null && 'name' in row) {
      const name = (row as { name: unknown }).name;
      if (typeof name === 'string') names.add(name);
    }
  }
  return names;
}

export interface IndexSpec {
  name: string;
  fields: string[];
  unique?: boolean;
}

/** Adds each index only if an index with the same name is not present. */
export async function ensureIndexes(
  qi: QueryInterface,
  tableName: string,
  indexes: IndexSpec[],
): Promise<void> {
  const existing = extractIndexNames(await qi.showIndex(tableName));
  for (const index of indexes) {
    if (existing.has(index.name)) continue;
    await qi.addIndex(tableName, index.fields, {
      name: index.name,
      unique: index.unique ?? false,
    });
  }
}

export async function dropTableIfExists(
  qi: QueryInterface,
  tableName: string,
): Promise<void> {
  if (await tableExists(qi, tableName)) {
    await qi.dropTable(tableName);
  }
}
