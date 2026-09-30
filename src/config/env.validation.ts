import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Test = 'test',
  Staging = 'staging',
  Production = 'production',
}

/** Secrets that must be ≥ 32 chars and all different from each other (guide S2). */
export const SECRET_KEYS = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'OTP_HASH_SECRET'] as const;

// Read the raw value: implicit conversion would turn the string 'false' into true.
const toBool = ({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown => {
  const raw = obj[key];
  return typeof raw === 'string' ? raw.trim().toLowerCase() === 'true' : raw;
};

/**
 * Every environment variable the app reads (guide Appendix D). Config loaders
 * read these validated, typed values; nothing else reads process.env.
 */
export class EnvironmentVariables {
  // App
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  /** Required in production (checked below). */
  @IsOptional()
  @IsString()
  TRUST_PROXY?: string;

  @IsOptional()
  @IsString()
  LOG_LEVEL?: string;

  /** Defaults to on outside production (resolved in app.config.ts). */
  @IsOptional()
  @IsBoolean()
  @Transform(toBool)
  SWAGGER_ENABLED?: boolean;

  // Database
  @IsString()
  @IsNotEmpty()
  DB_HOST: string;

  @IsInt()
  DB_PORT: number = 3306;

  @IsString()
  @IsNotEmpty()
  DB_USER: string;

  @IsString()
  DB_PASSWORD: string = '';

  @IsString()
  @IsNotEmpty()
  DB_NAME: string;

  @IsInt()
  @Min(2)
  DB_POOL_MAX: number = 20;

  @IsBoolean()
  @Transform(toBool)
  DB_LOGGING: boolean = false;

  @IsBoolean()
  @Transform(toBool)
  DB_SSL: boolean = false;

  // Redis
  @IsOptional()
  @Matches(/^rediss?:\/\/\S+$/, { message: 'REDIS_URL must be a redis:// or rediss:// URL' })
  REDIS_URL?: string;

  @IsBoolean()
  @Transform(toBool)
  REDIS_TLS: boolean = false;

  // JWT
  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET: string;

  @IsString()
  JWT_ACCESS_TTL: string = '15m';

  @IsString()
  JWT_REFRESH_EXPIRES_IN: string = '7d';

  @IsString()
  JWT_ISSUER: string = 'kuchu-puchu';

  @IsString()
  JWT_AUDIENCE: string = 'kuchu-puchu-app';

  // OTP
  @IsString()
  @MinLength(32)
  OTP_HASH_SECRET: string;

  @IsInt()
  @Min(4)
  @Max(10)
  OTP_LENGTH: number = 6;

  @IsInt()
  @Min(60)
  OTP_TTL_SECONDS: number = 300;

  @IsInt()
  @Min(1)
  @Max(10)
  OTP_MAX_ATTEMPTS: number = 5;

  @IsInt()
  @Min(0)
  OTP_RESEND_COOLDOWN_SECONDS: number = 60;

  @IsInt()
  @Min(1)
  OTP_MAX_PER_HOUR: number = 5;

  @IsBoolean()
  @Transform(toBool)
  OTP_DEV_ECHO: boolean = false;

  // Profile / preferences
  @IsInt()
  @Min(1)
  @Max(50)
  PROFILE_MAX_INTERESTS: number = 10;

  @IsInt()
  @Min(1)
  PREFERENCES_MIN_DISTANCE_KM: number = 1;

  @IsInt()
  @Min(1)
  @Max(20000)
  PREFERENCES_MAX_DISTANCE_KM: number = 500;

  // AWS / push (consumed by later modules)
  @IsOptional() @IsString() AWS_REGION?: string;
  @IsOptional() @IsString() FCM_PROJECT_ID?: string;
  @IsOptional() @IsString() FCM_CLIENT_EMAIL?: string;
  @IsOptional() @IsString() FCM_PRIVATE_KEY?: string;

  // NestJS Observe (optional; not in Appendix D)
  @IsOptional() @IsString() OBSERVE_APP_KEY?: string;
  @IsOptional() @IsString() OBSERVE_APP_SECRET?: string;
}

let validatedEnv: EnvironmentVariables | undefined;

/** Validates the raw environment. Throws with variable names only, never values. */
export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const isProd = validated.NODE_ENV === Environment.Production;
  if (isProd && validated.OTP_DEV_ECHO) {
    throw new Error('OTP_DEV_ECHO must not be enabled in production');
  }
  if (isProd && !validated.CORS_ORIGINS) {
    throw new Error('CORS_ORIGINS must be set in production');
  }
  if (isProd && !validated.TRUST_PROXY) {
    throw new Error('TRUST_PROXY must be set in production');
  }
  if (validated.PREFERENCES_MIN_DISTANCE_KM > validated.PREFERENCES_MAX_DISTANCE_KM) {
    throw new Error('PREFERENCES_MIN_DISTANCE_KM must not exceed PREFERENCES_MAX_DISTANCE_KM');
  }
  assertSecretsDistinct(validated);

  validatedEnv = validated;
  return validated;
}

function assertSecretsDistinct(env: EnvironmentVariables): void {
  for (let i = 0; i < SECRET_KEYS.length; i++) {
    for (let j = i + 1; j < SECRET_KEYS.length; j++) {
      if (env[SECRET_KEYS[i]] === env[SECRET_KEYS[j]]) {
        throw new Error(`${SECRET_KEYS[i]} and ${SECRET_KEYS[j]} must differ`);
      }
    }
  }
}

/**
 * The validated environment used by config loaders. ConfigModule runs
 * validateEnv first; standalone callers get process.env validated on demand.
 */
export function getValidatedEnv(): EnvironmentVariables {
  return validatedEnv ?? validateEnv(process.env);
}
