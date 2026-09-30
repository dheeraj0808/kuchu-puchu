import { registerAs } from '@nestjs/config';

import { envBool, envInt, envString } from './env.helpers';

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  poolMax: number;
  logging: boolean;
  ssl: boolean;
}

export default registerAs(
  'database',
  (): DatabaseConfig => ({
    host: envString('DB_HOST', 'localhost'),
    port: envInt('DB_PORT', 3306),
    username: envString('DB_USERNAME'),
    password: envString('DB_PASSWORD'),
    database: envString('DB_DATABASE'),
    poolMax: envInt('DB_POOL_MAX', 10),
    logging: envBool('DB_LOGGING', false),
    ssl: envBool('DB_SSL', false),
  }),
);
