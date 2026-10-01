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

/** Process type (guide §3.1): the same build runs as API, Realtime or Worker. */
export enum AppRole {
  Api = 'api',
  Realtime = 'realtime',
  Worker = 'worker',
}

/** The role to run when APP_ROLE is not set explicitly. */
export function resolveAppRole(env: { APP_ROLE?: AppRole }): AppRole {
  return env.APP_ROLE ?? AppRole.Api;
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

  /**
   * No default here: validated defaults are copied into process.env, and an
   * entry point must be able to tell "not set" (use its own role) from an
   * explicit, conflicting value. resolveAppRole() applies the api default.
   */
  @IsOptional()
  @IsEnum(AppRole)
  APP_ROLE?: AppRole;

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

  // Redis. Required in production (checked below); defaults to a local server otherwise.
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

  /** Sliding session lifetime: each refresh moves expires_at to now + this (guide M06). */
  @IsInt()
  @Min(1)
  @Max(365)
  SESSION_SLIDING_DAYS: number = 30;

  /** Hard session lifetime from sign-in, never extended (guide M06). */
  @IsInt()
  @Min(1)
  @Max(365)
  SESSION_MAX_DAYS: number = 90;

  /** Live sessions per user; a login beyond it revokes the least recently used one ("replaced"). */
  @IsInt()
  @Min(1)
  @Max(100)
  SESSION_MAX_PER_USER: number = 10;

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

  /** Per request IP; generous because of mobile carrier NAT (guide M06). */
  @IsInt()
  @Min(1)
  OTP_MAX_PER_IP_PER_HOUR: number = 20;

  /** Per X-Device-Id; requests without the header share one bucket per IP. */
  @IsInt()
  @Min(1)
  OTP_MAX_PER_DEVICE_PER_HOUR: number = 10;

  /** Step-up codes per identifier per hour, counted apart from sign-in codes. */
  @IsInt()
  @Min(1)
  OTP_REAUTH_MAX_PER_HOUR: number = 5;

  /** Comma-separated calling codes that may receive SMS codes, e.g. "+91,+971". */
  @Matches(/^\+[1-9]\d{0,3}(,\+[1-9]\d{0,3})*$/, {
    message: 'OTP_SMS_ALLOWED_COUNTRIES must be comma-separated calling codes such as +91',
  })
  OTP_SMS_ALLOWED_COUNTRIES: string = '+91';

  @IsBoolean()
  @Transform(toBool)
  OTP_DEV_ECHO: boolean = false;

  // SMS / Email (guide M06, Appendix D)
  /** Only "fake" exists until the DLT-registered provider is added; production refuses it (checked below). */
  @IsOptional()
  @Matches(/^[a-z0-9_-]{1,32}$/, { message: 'SMS_PROVIDER must be a provider name such as fake' })
  SMS_PROVIDER?: string;

  @IsOptional() @IsString() SMS_API_KEY?: string;
  @IsOptional() @IsString() SMS_SENDER_ID?: string;
  @IsOptional() @IsString() SMS_DLT_TEMPLATE_ID?: string;

  /** SMS codes sent per IST calendar day across all users; alert at 80 %, stop at 100 %. */
  @IsInt()
  @Min(1)
  SMS_DAILY_BUDGET: number = 10_000;

  /**
   * Share (%) of SMS_DAILY_BUDGET for identifiers no account holds yet. The rest
   * is reserved for existing accounts, so a flood of random numbers never
   * blocks their sign-in or step-up.
   */
  @IsInt()
  @Min(0)
  @Max(100)
  SMS_BUDGET_NEW_IDENTIFIER_PERCENT: number = 70;

  /** OTP emails per IST calendar day across all users; alert at 80 %, stop at 100 %. */
  @IsInt()
  @Min(1)
  EMAIL_DAILY_BUDGET: number = 20_000;

  /** Sender for OTP emails. With SES_REGION it selects SES; both are required in production. */
  @IsOptional()
  @Matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'EMAIL_FROM must be an email address' })
  EMAIL_FROM?: string;

  @IsOptional()
  @Matches(/^[a-z]{2}(-[a-z]+)+-\d$/, { message: 'SES_REGION must be an AWS region such as ap-south-1' })
  SES_REGION?: string;

  // AWS / storage (M07). Credentials come from the IAM role, never from keys.
  @IsOptional()
  @Matches(/^[a-z]{2}(-[a-z]+)+-\d$/, { message: 'AWS_REGION must be an AWS region such as ap-south-1' })
  AWS_REGION?: string;

  /** Private bucket for data exports (and later private media). Required in production (checked below). */
  @IsOptional()
  @Matches(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, { message: 'S3_BUCKET_PRIVATE must be an S3 bucket name' })
  S3_BUCKET_PRIVATE?: string;

  /** Directory for the local storage fake (development / test; not in Appendix D). Default: the OS temp dir. */
  @IsOptional() @IsString() STORAGE_LOCAL_DIR?: string;

  // Push (consumed by later modules)
  @IsOptional() @IsString() FCM_PROJECT_ID?: string;
  @IsOptional() @IsString() FCM_CLIENT_EMAIL?: string;
  @IsOptional() @IsString() FCM_PRIVATE_KEY?: string;

  // Outbox and jobs (M03; not in Appendix D)
  @IsInt()
  @Min(100)
  @Max(60_000)
  OUTBOX_RELAY_INTERVAL_MS: number = 1000;

  /** Must be below OUTBOX_RELAY_INTERVAL_MS (checked below) so ticks do not overlap. */
  @IsInt()
  @Min(50)
  @Max(60_000)
  OUTBOX_RELAY_TIME_BUDGET_MS: number = 800;

  @IsInt()
  @Min(1)
  @Max(1000)
  OUTBOX_BATCH_SIZE: number = 200;

  /** attempts is a TINYINT UNSIGNED column. */
  @IsInt()
  @Min(1)
  @Max(16)
  OUTBOX_MAX_ATTEMPTS: number = 8;

  @IsInt()
  @Min(1)
  @Max(60_000)
  OUTBOX_BACKOFF_BASE_MS: number = 1000;

  @IsInt()
  @Min(100)
  @Max(30_000)
  OUTBOX_ENQUEUE_TIMEOUT_MS: number = 1000;

  @IsInt()
  @Min(1)
  @Max(365)
  OUTBOX_CLEANUP_AGE_DAYS: number = 7;

  /** 21:30 UTC is 03:00 IST, the low-traffic hour for our users. */
  @Matches(/^\S+( \S+){4}$/, { message: 'OUTBOX_CLEANUP_CRON must be a 5-field cron pattern' })
  OUTBOX_CLEANUP_CRON: string = '30 21 * * *';

  @IsInt()
  @Min(256)
  @Max(65_536)
  OUTBOX_PAYLOAD_MAX_BYTES: number = 16_384;

  @IsInt()
  @Min(1)
  @Max(720)
  OUTBOX_COMPLETED_JOB_RETENTION_HOURS: number = 24;

  @IsInt()
  @Min(1)
  @Max(90)
  OUTBOX_FAILED_JOB_RETENTION_DAYS: number = 14;

  // Security-events retention (M05; not in Appendix D)
  @IsInt()
  @Min(30)
  @Max(3650)
  SECURITY_EVENTS_RETENTION_DAYS: number = 365;

  @IsInt()
  @Min(30)
  @Max(3650)
  SECURITY_EVENTS_ADMIN_RETENTION_DAYS: number = 1095;

  /** 21:45 UTC is 03:15 IST. */
  @Matches(/^\S+( \S+){4}$/, { message: 'SECURITY_EVENTS_RETENTION_CRON must be a 5-field cron pattern' })
  SECURITY_EVENTS_RETENTION_CRON: string = '45 21 * * *';

  // Monitoring. Sentry is only enabled when SENTRY_DSN is set.
  @IsOptional()
  @Matches(/^https:\/\/\S+$/, { message: 'SENTRY_DSN must be an https:// URL' })
  SENTRY_DSN?: string;

  /** Slack-compatible incoming webhook for job alerts. Required in production (checked below). */
  @IsOptional()
  @Matches(/^https:\/\/\S+$/, { message: 'ALERT_WEBHOOK_URL must be an https:// URL' })
  ALERT_WEBHOOK_URL?: string;

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
  // Codes printed to stdout end up in the log pipeline: only on a developer's machine or in tests.
  if (validated.OTP_DEV_ECHO && validated.NODE_ENV !== Environment.Development && validated.NODE_ENV !== Environment.Test) {
    throw new Error('OTP_DEV_ECHO must not be enabled in production or staging');
  }
  if (isProd && !validated.CORS_ORIGINS) {
    throw new Error('CORS_ORIGINS must be set in production');
  }
  if (isProd && !validated.TRUST_PROXY) {
    throw new Error('TRUST_PROXY must be set in production');
  }
  // "true" makes req.ip the left-most X-Forwarded-For value, which the client controls, so every
  // per-IP limit (OTP caps, throttles) could be bypassed. Production names the hop count or the proxy subnets.
  if (isProd && validated.TRUST_PROXY && !isSafeTrustProxy(validated.TRUST_PROXY)) {
    throw new Error('TRUST_PROXY in production must be a hop count (e.g. 1) or a list of proxy IPs/subnets, not "true"');
  }
  if (isProd && !validated.REDIS_URL) {
    throw new Error('REDIS_URL must be set in production');
  }
  if (isProd && !validated.ALERT_WEBHOOK_URL) {
    throw new Error('ALERT_WEBHOOK_URL must be set in production');
  }
  if (isProd && (!validated.SMS_PROVIDER || validated.SMS_PROVIDER === 'fake')) {
    throw new Error('SMS_PROVIDER must name a real SMS provider in production (not unset or "fake")');
  }
  // Half an S3 config would silently fall back to local files.
  if (validated.S3_BUCKET_PRIVATE && !validated.AWS_REGION) {
    throw new Error('S3_BUCKET_PRIVATE needs AWS_REGION');
  }
  if (isProd && (!validated.AWS_REGION || !validated.S3_BUCKET_PRIVATE)) {
    throw new Error('AWS_REGION and S3_BUCKET_PRIVATE must be set in production');
  }
  if (isProd && (!validated.EMAIL_FROM || !validated.SES_REGION)) {
    throw new Error('EMAIL_FROM and SES_REGION must be set in production');
  }
  if (validated.SESSION_SLIDING_DAYS > validated.SESSION_MAX_DAYS) {
    throw new Error('SESSION_SLIDING_DAYS must not exceed SESSION_MAX_DAYS');
  }
  if (validated.OUTBOX_RELAY_TIME_BUDGET_MS >= validated.OUTBOX_RELAY_INTERVAL_MS) {
    throw new Error('OUTBOX_RELAY_TIME_BUDGET_MS must be below OUTBOX_RELAY_INTERVAL_MS');
  }
  if (validated.SECURITY_EVENTS_ADMIN_RETENTION_DAYS < validated.SECURITY_EVENTS_RETENTION_DAYS) {
    throw new Error('SECURITY_EVENTS_ADMIN_RETENTION_DAYS must not be below SECURITY_EVENTS_RETENTION_DAYS');
  }
  assertSecretsDistinct(validated);

  validatedEnv = validated;
  return validated;
}

const TRUST_PROXY_NAMES = new Set(['loopback', 'linklocal', 'uniquelocal']);
const IP_OR_CIDR = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f:]+)(\/\d{1,3})?$/i;

function isSafeTrustProxy(raw: string): boolean {
  const value = raw.trim();
  if (/^\d+$/.test(value)) return Number(value) >= 1 && Number(value) <= 5;
  return value
    .split(',')
    .map((v) => v.trim())
    .every((v) => v !== '' && (TRUST_PROXY_NAMES.has(v.toLowerCase()) || (IP_OR_CIDR.test(v) && !tooBroad(v))));
}

/** A prefix this wide (e.g. 0.0.0.0/1) would trust client-chosen addresses again. */
function tooBroad(cidr: string): boolean {
  const [ip, bits] = cidr.split('/');
  if (bits === undefined) return false;
  return Number(bits) < (ip.includes(':') ? 32 : 8);
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
