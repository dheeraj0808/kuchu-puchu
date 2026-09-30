# M01 Core Foundation: gap checklist

| | |
|---|---|
| Date | 2026-09-30 |
| Spec | `backend/docs/Kuchu-Puchu-Backend-Developer-Guide.pdf` v1.0: §8 M01 build list and "Done when", plus the §4 conventions and §5 security rules that M01 implements. Appendix C (error codes) and D (env vars) are used where M01 refers to them. |
| Scope | M01 only. Rules that belong to later modules are not assessed here. No code was changed. |
| Status key | **done**: matches the spec · **partial**: exists but differs from the spec or is incomplete · **missing**: not in the code |

Paths are relative to `backend/`.

## Summary

| Area | Done | Partial | Missing |
|---|---|---|---|
| 1. Bootstrap | 5 | 1 | 2 |
| 2. Config | 2 | 3 | 1 |
| 3. Database | 1 | 3 | 0 |
| 4. Redis | 0 | 0 | 3 |
| 5. Errors | 1 | 3 | 0 |
| 6. Responses | 0 | 1 | 1 |
| 7. Logging | 3 | 1 | 0 |
| 8. Guards & decorators | 2 | 1 | 3 |
| 9. Rate limiting | 1 | 0 | 2 |
| 10. Utilities | 0 | 2 | 3 |
| 11. Docs & tooling | 3 | 0 | 3 |
| 12. "Done when" | 1 | 1 | 2 |
| **Total (55)** | **19** | **16** | **20** |

The main gaps: there is no Redis anywhere, the global prefix is `/api` instead of `/api/v1`, `realtime.ts` and `worker.ts` don't exist, three of the four guards are missing, and there is no Docker setup or CI.

---

## 1. Bootstrap

| # | Item | Status | Where | Notes |
|---|---|---|---|---|
| 1.1 | `main.ts` API entry | **done** | `src/main.ts` | |
| 1.2 | `realtime.ts` entry | **missing** | — | No Socket.IO entry file. `@nestjs/websockets` and `socket.io` are not in `package.json`. |
| 1.3 | `worker.ts` entry | **missing** | — | No worker entry file. `APP_ROLE` is not defined. |
| 1.4 | helmet + compression | **done** | `src/main.ts:46-47` | |
| 1.5 | CORS allowlist | **done** | `src/main.ts:30-34, 50-68` | Uses `CORS_ORIGINS`, which is required in production (`src/config/env.validation.ts:188`). `allowedHeaders` does not include `X-App-Version` or `X-Platform` (§4.1 client headers). |
| 1.6 | Global prefix `/api/v1` | **partial** | `src/main.ts:70` | Set to `'api'`, so routes are `/api/...`. Versioning is not enabled. |
| 1.7 | Body limit 100 kb | **done** | `src/main.ts:48` | JSON limited to 100 kb. No multipart routes exist yet. |
| 1.8 | Graceful shutdown on SIGTERM | **done** | `src/main.ts:76` | `enableShutdownHooks()`. No custom drain logic, which isn't needed until Redis and queues exist. |

## 2. Config

| # | Item | Status | Where | Notes |
|---|---|---|---|---|
| 2.1 | `@nestjs/config` with typed `registerAs` loaders | **done** | `src/config/*.config.ts`, `src/config/index.ts`, `src/app.module.ts:44-50` | Loaders: app, database, jwt, otp, profile, redis, aws, firebase. |
| 2.2 | Boot fails fast on a missing or invalid variable | **done** | `src/config/env.validation.ts:166-195`, spec in `env.validation.spec.ts` | Errors list variable names only, never values. |
| 2.3 | Secrets ≥ 32 characters and different from each other (S2) | **partial** | `src/config/env.validation.ts:85-108, 191` | Minimum length is enforced for all three secrets. Only access ≠ refresh is checked. `OTP_HASH_SECRET` can equal either JWT secret. |
| 2.4 | `TRUST_PROXY` required in production | **missing** | `src/config/env.validation.ts:41-43` | Optional in every environment. |
| 2.5 | Variable names match Appendix D | **partial** | `src/config/env.validation.ts`, `.env.example` | Differences: `DB_USERNAME`/`DB_DATABASE` (spec `DB_USER`/`DB_NAME`), `REDIS_HOST/PORT/PASSWORD` (spec `REDIS_URL`, `REDIS_TLS`), `JWT_ACCESS_EXPIRES_IN` (spec `JWT_ACCESS_TTL`), `OTP_MAX_REQUESTS_PER_HOUR` (spec `OTP_MAX_PER_HOUR`), `AWS_S3_BUCKET`/`FIREBASE_*` (spec `S3_BUCKET_*`/`FCM_*`). Missing from spec: `APP_ROLE`, `SENTRY_DSN`, `ALERT_WEBHOOK_URL`, `DB_REPLICA_HOST`. |
| 2.6 | Loaders read validated values | **partial** | `src/config/env.helpers.ts` | Loaders re-read `process.env` with their own fallbacks, so validation and loaders can drift. For example, `envInt` silently falls back when a value isn't a number. Validation still runs first, so boot does fail on bad input. |

## 3. Database

| # | Item | Status | Where | Notes |
|---|---|---|---|---|
| 3.1 | Sequelize module, `synchronize: false` | **done** | `src/database/database.module.ts:19-54` | UTC timezone, `underscored: true`, bind parameters never logged. |
| 3.2 | Connection pool min 2, max 20 | **partial** | `src/database/database.module.ts:36`, `src/config/database.config.ts:24` | Pool is `min: 0` and `max: DB_POOL_MAX`, which defaults to 10. |
| 3.3 | Umzug runner via `npm run migrate` | **partial** | `src/database/migrate.ts`, `package.json:22-26` | The runner works (up, down, status, db:create), but the scripts are `migration:up` / `migration:prod`. There is no `migrate` script. |
| 3.4 | Seeders for catalogue data | **partial** | `src/database/migrations/20261001000004-seed-interests.ts`, `src/interests/interests.seed.ts` | Interests are seeded through a migration. There is no `database/seeders/` folder and no seed command. Prompts are not seeded (they are an M08 table). |
| — | Charset/collation (§4.2) | *note* | `src/database/database.module.ts:40`, `src/database/migrations/helpers.ts:12`, `migrate.ts:70` | Uses `utf8mb4_unicode_ci`. The spec requires `utf8mb4_0900_ai_ci`. |

## 4. Redis

| # | Item | Status | Where | Notes |
|---|---|---|---|---|
| 4.1 | Shared ioredis client module | **missing** | — | `ioredis` is not a dependency. `redisConfig` in `src/config/integrations.config.ts:6` is a placeholder and nothing uses it. |
| 4.2 | BullMQ connection | **missing** | — | `bullmq` is not a dependency. |
| 4.3 | Key naming `kp:<area>:<id>` | **missing** | — | There are no Redis keys. |

## 5. Errors

| # | Item | Status | Where | Notes |
|---|---|---|---|---|
| 5.1 | `ErrorCode` enum | **partial** | `src/common/exceptions/app.exception.ts:3-22` | Has the M01 codes (`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `INTERNAL_ERROR`). Missing `PROVIDER_UNAVAILABLE`. Also has codes that aren't in Appendix C: `INVALID_REQUEST`, `NOT_FOUND`, `INVALID_REFRESH_TOKEN`, `INVALID_INTERESTS`, `PREFERENCES_ALREADY_EXIST`, `PREFERENCES_NOT_FOUND`. |
| 5.2 | `AppException(ErrorCode.X, details?)` | **partial** | `src/common/exceptions/app.exception.ts:28-37` | The signature is `(code, message, status, details?)`, so every caller passes the HTTP status and message by hand. There is no code → status map. The spec's form `AppException(ErrorCode.X, details?)` (§4.4) is not supported. |
| 5.3 | Global `AllExceptionsFilter` producing the §4.1 error body | **partial** | `src/common/filters/all-exceptions.filter.ts`, registered at `src/main.ts:72` | Has `success`, `code`, `message`, `details`, `requestId`. It also adds `timestamp` and `path`, which the §4.1 body doesn't include. On 429, `details.retryAfterSeconds` (Appendix C) is not set. |
| 5.4 | Library messages never reach clients | **done** | `src/common/filters/all-exceptions.filter.ts:109-122, 144-151` | Errors ≥ 500 and unknown errors return a generic `INTERNAL_ERROR` and the stack is logged on the server only. Validation messages come from class-validator field rules, with values hidden (`src/common/pipes/validation.pipe.ts:11`). |

## 6. Responses

| # | Item | Status | Where | Notes |
|---|---|---|---|---|
| 6.1 | `ResponseInterceptor` wraps into `{ success, data }` | **partial** | `src/common/interceptors/response.interceptor.ts`, registered at `src/main.ts:75` | Wraps correctly but adds a `timestamp` field that isn't in the §4.1 success body. |
| 6.2 | `meta: { nextCursor }` for lists | **missing** | — | The interceptor has no way to return `meta`. There is no pagination helper. |

## 7. Logging

| # | Item | Status | Where | Notes |
|---|---|---|---|---|
| 7.1 | pino JSON logs | **done** | `src/common/logging/logger.module.ts`, `src/main.ts:37-40` | nestjs-pino. Uses pino-pretty in development only. |
| 7.2 | Request id (`x-request-id`) | **done** | `src/common/logging/logger.module.ts:53-62` | Accepts a valid incoming id or generates a UUID, and echoes it in the response header. |
| 7.3 | Redaction of auth headers, tokens, OTP, phone, email | **done** | `src/common/logging/logger.module.ts:12-27` | `req.body` is redacted entirely. |
| 7.4 | Redaction depth | **partial** | same | The `*.otp`, `*.email`, … wildcards match only one level of nesting. A field such as `err.details.phone` would be logged. Sentry (§3.2 tech stack) is not set up. |

## 8. Guards & decorators

| # | Item | Status | Where | Notes |
|---|---|---|---|---|
| 8.1 | `JwtAuthGuard` | **done** | `src/auth/guards/jwt-auth.guard.ts`, `src/auth/strategies/jwt.strategy.ts` | Checks signature, expiry, issuer, audience and HS256, then the session row, and reads the role from the DB (S3). It lives under `auth/` rather than `common/`. The session lookup is not cached in Redis (see §4). |
| 8.2 | `VerifiedUserGuard` | **missing** | — | |
| 8.3 | `RolesGuard` + `@Roles()` | **missing** | — | |
| 8.4 | `EntitlementGuard` + `@RequiresEntitlement()` | **missing** | — | No entitlement stub either (§3.5 says a stub returns Free plan limits until M21). |
| 8.5 | `@CurrentUser()` | **done** | `src/common/decorators/current-user.decorator.ts` | |
| 8.6 | `@ClientContext()` (IP, UA, app version, device id) | **partial** | `src/common/decorators/client-context.decorator.ts`, `src/common/utils/request-context.ts` | Returns IP and UA only. App version, platform and device id are not read from the headers. |

## 9. Rate limiting

| # | Item | Status | Where | Notes |
|---|---|---|---|---|
| 9.1 | `@nestjs/throttler`, default 100 req / 60 s per IP | **done** | `src/app.module.ts:56, 76` | Global `ThrottlerGuard`. Health is skipped (`src/health/health.controller.ts:6`). |
| 9.2 | Redis storage (S4: works across instances) | **missing** | `src/app.module.ts:55` | In-memory storage. There is a `TODO` comment for this. |
| 9.3 | Per-user limits via a custom tracker keyed by user id | **missing** | — | No `getTracker` override. All limits, including the `@Throttle` on auth and account routes, are per IP. |

## 10. Utilities

| # | Item | Status | Where | Notes |
|---|---|---|---|---|
| 10.1 | UUID v7 generator | **missing** | `src/users/models/user.model.ts:40`, `src/security/models/security-event.model.ts:44`, seed migration line 18 | All IDs use `UUIDV4` / `randomUUID()` (v4). §4.2 requires v7. |
| 10.2 | Text sanitizer (trim, collapse whitespace, strip control chars) | **partial** | `src/profiles/utils/sanitize.util.ts` | The function does everything the spec asks, but it lives in `profiles/` rather than `common/`. |
| 10.3 | Cursor encode/decode (base64url JSON) | **missing** | — | |
| 10.4 | HMAC helpers | **partial** | `src/auth/utils/crypto.util.ts:18-34` | `hmacSha256` and `timingSafeEqualHex` exist and work, but they live in `auth/` rather than `common/`. |
| 10.5 | Distance bucket helper | **missing** | — | No `LT_2_KM`…`GT_100_KM` helper. |

## 11. Docs & tooling

| # | Item | Status | Where | Notes |
|---|---|---|---|---|
| 11.1 | Swagger at `/api/docs`, disabled in production | **done** | `src/common/swagger.ts`, `src/main.ts:78-80`, `src/config/app.config.ts:25` | Off by default in production. It can still be turned on with `SWAGGER_ENABLED=true`, which Appendix D allows. |
| 11.2 | Dockerfile | **missing** | — | |
| 11.3 | docker-compose (MySQL, Redis, LocalStack) | **missing** | — | |
| 11.4 | Lint | **done** | `package.json:16`, `oxlint.json` | oxlint. Prettier is configured (`.prettierrc`, `format` script). |
| 11.5 | Test | **done** | `package.json:17-21`, `jest.config.ts`, `test/jest-e2e.json` | Unit tests exist. No integration tests with Testcontainers (§3.2, Appendix E). |
| 11.6 | CI pipeline (lint, type-check, unit + integration) | **missing** | — | No `.github/` or other CI config. There is no separate `typecheck` script, although `nest build` does type-check. |

## 12. "Done when" criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 12.1 | App boots with valid env and refuses invalid env | **done** | `src/config/env.validation.ts`, `src/config/env.validation.spec.ts` |
| 12.2 | Error and success bodies match §4.1 | **partial** | Both bodies add a `timestamp` field, the error body adds `path`, and there is no `meta`. See 5.3 and 6.1–6.2. |
| 12.3 | CI runs lint, type-check, unit and integration tests | **missing** | No CI, and no integration tests. |
| 12.4 | `docker-compose up` gives a working local stack | **missing** | No compose file. |

Two more things about `test/app.e2e-spec.ts`. It boots the full `AppModule`, so it needs a live MySQL. It also doesn't install the global filter or interceptor, so it asserts `{ status: 'ok' }` instead of the wrapped body. As written it won't catch regressions in the response shape.

---

## Out of scope but seen

These are outside M01, so they aren't scored. Listed only so they don't get lost:

- **§3.4 folder layout:** there is no `src/infra/` or `src/modules/`. Feature modules sit directly under `src/`.
- **Stub modules:** stub feature modules are already imported in `src/app.module.ts:60-74` (discovery, matching, likes, chat, media, and others).
- **Observe module:** `@nestjs/observe` is wired in `src/app.module.ts:29-40`. The guide doesn't mention it.
