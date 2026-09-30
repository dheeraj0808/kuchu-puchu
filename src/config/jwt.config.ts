import { registerAs } from '@nestjs/config';

import { envString } from './env.helpers';

export interface JwtConfig {
  accessSecret: string;
  refreshSecret: string;
  accessExpiresIn: string;
  refreshExpiresIn: string;
  issuer: string;
  audience: string;
}

export default registerAs(
  'jwt',
  (): JwtConfig => ({
    accessSecret: envString('JWT_ACCESS_SECRET'),
    refreshSecret: envString('JWT_REFRESH_SECRET'),
    accessExpiresIn: envString('JWT_ACCESS_EXPIRES_IN', '15m'),
    refreshExpiresIn: envString('JWT_REFRESH_EXPIRES_IN', '7d'),
    issuer: envString('JWT_ISSUER', 'kuchu-puchu'),
    audience: envString('JWT_AUDIENCE', 'kuchu-puchu-app'),
  }),
);
