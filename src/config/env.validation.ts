import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
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

// Read the raw value: implicit conversion would turn the string 'false' into true.
const toBool = ({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown => {
  const raw = obj[key];
  return typeof raw === 'string' ? raw.trim().toLowerCase() === 'true' : raw;
};

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsOptional()
  @IsString()
  TRUST_PROXY?: string;

  @IsOptional()
  @IsString()
  LOG_LEVEL?: string;

  @IsBoolean()
  @Transform(toBool)
  SWAGGER_ENABLED: boolean = true;

  // Database
  @IsString()
  @IsNotEmpty()
  DB_HOST: string;

  @IsInt()
  DB_PORT: number = 3306;

  @IsString()
  @IsNotEmpty()
  DB_USERNAME: string;

  @IsString()
  DB_PASSWORD: string = '';

  @IsString()
  @IsNotEmpty()
  DB_DATABASE: string;

  @IsInt()
  @Min(1)
  DB_POOL_MAX: number = 10;

  @IsBoolean()
  @Transform(toBool)
  DB_LOGGING: boolean = false;

  @IsBoolean()
  @Transform(toBool)
  DB_SSL: boolean = false;

  // JWT
  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET: string;

  @IsString()
  JWT_ACCESS_EXPIRES_IN: string = '15m';

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
  OTP_MAX_REQUESTS_PER_HOUR: number = 5;

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

  // Future integrations (optional for now)
  @IsOptional() @IsString() REDIS_HOST?: string;
  @IsOptional() @IsInt() REDIS_PORT?: number;
  @IsOptional() @IsString() REDIS_PASSWORD?: string;
  @IsOptional() @IsString() AWS_REGION?: string;
  @IsOptional() @IsString() AWS_ACCESS_KEY_ID?: string;
  @IsOptional() @IsString() AWS_SECRET_ACCESS_KEY?: string;
  @IsOptional() @IsString() AWS_S3_BUCKET?: string;
  @IsOptional() @IsString() FIREBASE_PROJECT_ID?: string;
  @IsOptional() @IsString() FIREBASE_CLIENT_EMAIL?: string;
  @IsOptional() @IsString() FIREBASE_PRIVATE_KEY?: string;
  @IsOptional() @IsString() OBSERVE_APP_KEY?: string;
  @IsOptional() @IsString() OBSERVE_APP_SECRET?: string;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    // Only property names and constraint messages — never values.
    const details = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const isProd = validated.NODE_ENV === Environment.Production;
  if (isProd && validated.OTP_DEV_ECHO) {
    throw new Error('OTP_DEV_ECHO must not be enabled in production');
  }
  if (validated.PREFERENCES_MIN_DISTANCE_KM > validated.PREFERENCES_MAX_DISTANCE_KM) {
    throw new Error('PREFERENCES_MIN_DISTANCE_KM must not exceed PREFERENCES_MAX_DISTANCE_KM');
  }
  if (isProd && !validated.CORS_ORIGINS) {
    throw new Error('CORS_ORIGINS must be set in production');
  }
  if (validated.JWT_ACCESS_SECRET === validated.JWT_REFRESH_SECRET) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
  }
  return validated;
}
