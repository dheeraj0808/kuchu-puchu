import { registerAs } from '@nestjs/config';

import { getValidatedEnv } from './env.validation';

/** Guide M01: every instance keeps at least 2 connections open. */
export const DB_POOL_MIN = 2;

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  poolMin: number;
  poolMax: number;
  logging: boolean;
  ssl: boolean;
}

export default registerAs('database', (): DatabaseConfig => {
  const env = getValidatedEnv();
  return {
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    poolMin: DB_POOL_MIN,
    poolMax: env.DB_POOL_MAX,
    logging: env.DB_LOGGING,
    ssl: env.DB_SSL,
  };
});
