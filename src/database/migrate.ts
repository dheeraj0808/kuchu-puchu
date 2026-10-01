import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { QueryTypes, Sequelize, type Options, type QueryInterface } from 'sequelize';
import { SequelizeStorage, Umzug } from 'umzug';

import { type MigrationDefinition, migrations } from './migrations';
import { assertSupportedServer } from './server-version';
import { runSeeders, type SeederDefinition, seeders } from './seeders';

/** Reverting is for local development only. */
const DOWN_ALLOWED_ENVS = new Set(['development', 'test']);

const DB_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

function loadEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch {
    console.warn('Warning: could not load .env file');
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function envBool(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

function databaseName(): string {
  const name = requireEnv('DB_NAME');
  if (!DB_NAME_PATTERN.test(name)) {
    throw new Error('DB_NAME contains invalid characters');
  }
  return name;
}

function buildSequelize(withDatabase: boolean): Sequelize {
  const port = Number.parseInt(process.env.DB_PORT ?? '3306', 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('DB_PORT must be a positive integer');
  }
  const options: Options = {
    dialect: 'mysql',
    host: process.env.DB_HOST ?? 'localhost',
    port,
    username: requireEnv('DB_USER'),
    password: process.env.DB_PASSWORD ?? '',
    timezone: '+00:00',
    logging: false,
    define: { charset: 'utf8mb4', collate: 'utf8mb4_0900_ai_ci' },
    dialectOptions: {
      charset: 'utf8mb4',
      ...(envBool('DB_SSL') ? { ssl: { rejectUnauthorized: true } } : {}),
    },
  };
  if (withDatabase) options.database = databaseName();
  return new Sequelize(options);
}

async function createDatabase(): Promise<void> {
  const name = databaseName();
  const sequelize = buildSequelize(false);
  try {
    await assertServer(sequelize);
    await sequelize.query(
      `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
    console.log(`Database "${name}" is ready`);
  } finally {
    await sequelize.close();
  }
}

function buildUmzug(
  sequelize: Sequelize,
  steps: Array<MigrationDefinition | SeederDefinition>,
  tableName: string,
): Umzug<QueryInterface> {
  const log = (event: string) => (message: Record<string, unknown>) => {
    const name = typeof message.name === 'string' ? message.name : '';
    console.log(`${event}${name ? `: ${name}` : ''}`);
  };
  return new Umzug<QueryInterface>({
    migrations: steps.map((m) => ({
      name: m.name,
      up: m.up,
      down: m.down,
    })),
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize, tableName }),
    logger: {
      info: (message) => {
        const event = typeof message.event === 'string' ? message.event : 'info';
        log(event)(message);
      },
      warn: log('warn'),
      error: log('error'),
      debug: () => undefined,
    },
  });
}

async function assertServer(sequelize: Sequelize): Promise<void> {
  const [{ version }] = await sequelize.query<{ version: string }>('SELECT VERSION() AS version', {
    type: QueryTypes.SELECT,
  });
  assertSupportedServer(version);
}

async function runMigrations(command: string): Promise<void> {
  const sequelize = buildSequelize(true);
  try {
    await sequelize.authenticate();
    await assertServer(sequelize);
    const umzug = buildUmzug(sequelize, migrations, 'sequelize_meta');
    switch (command) {
      case 'up': {
        const applied = await umzug.up();
        console.log(
          applied.length
            ? `Applied ${applied.length} migration(s)`
            : 'No pending migrations',
        );
        break;
      }
      case 'down': {
        const env = process.env.NODE_ENV ?? 'development';
        if (!DOWN_ALLOWED_ENVS.has(env)) {
          throw new Error(
            `Refusing to revert migrations with NODE_ENV=${env}. Migrations are forward-only outside development.`,
          );
        }
        const reverted = await umzug.down();
        console.log(
          reverted.length
            ? `Reverted ${reverted.length} migration(s)`
            : 'No executed migrations to revert',
        );
        break;
      }
      case 'status': {
        const executed = await umzug.executed();
        const pending = await umzug.pending();
        console.log(`Executed (${executed.length}):`);
        for (const m of executed) console.log(`  [x] ${m.name}`);
        console.log(`Pending (${pending.length}):`);
        for (const m of pending) console.log(`  [ ] ${m.name}`);
        break;
      }
      case 'seed': {
        // Every seeder upserts, so all of them run every time (M08).
        await runSeeders(sequelize);
        console.log(`Ran ${seeders.length} seeder(s)`);
        break;
      }
      default:
        throw new Error(
          `Unknown command "${command}". Use: up | down | status | seed | db:create`,
        );
    }
  } finally {
    await sequelize.close();
  }
}

async function main(): Promise<void> {
  loadEnv();
  const command = process.argv[2] ?? 'up';
  if (command === 'db:create') {
    await createDatabase();
    return;
  }
  await runMigrations(command);
}

main().catch((error: unknown) => {
  console.error(
    `Migration failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
