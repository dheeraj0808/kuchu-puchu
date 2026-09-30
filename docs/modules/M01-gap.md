# M01 Core Foundation: gap checklist

| | |
|---|---|
| Date | 2026-09-30 (audit) · 2026-09-30 (re-checked after Part C, Done-when verified) |
| Spec | `backend/docs/Kuchu-Puchu-Backend-Developer-Guide.pdf` v1.0: §8 M01 build list and "Done when", plus the §4 conventions and §5 security rules that M01 implements. Appendix C (error codes) and D (env vars) are used where M01 refers to them. |
| Scope | M01 only. Rules that belong to later modules are not assessed here. |
| Status key | **Before**: the original audit · **Now**: [x] done in the code · [ ] not done · **PENDING**: done in the code, but the "Done when" check can't be run here |

Paths are relative to `backend/`. Each "Now" row was re-checked against the code at `feat(M01): guards, utilities, entry points and CI`, not taken from the earlier session.

## Summary

| Area | Items | Done now | Not done |
|---|---|---|---|
| 1. Bootstrap | 8 | 8 | 0 |
| 2. Config | 6 | 6 | 0 |
| 3. Database | 4 + note | 4 | 0 |
| 4. Redis | 3 | 3 | 0 |
| 5. Errors | 4 | 4 | 0 |
| 6. Responses | 2 | 2 | 0 |
| 7. Logging | 4 | 4 | 0 |
| 8. Guards & decorators | 6 | 6 | 0 |
| 9. Rate limiting | 3 | 3 | 0 |
| 10. Utilities | 5 | 5 | 0 |
| 11. Docs & tooling | 6 | 5 | 1 (Dockerfile) |
| 12. "Done when" | 4 | 2 verified | 2 PENDING |

Still open: no Dockerfile (11.2), CI and docker-compose not yet proven by a run (12.3, 12.4), and the boot-error defect found while verifying 12.1 (see below).

---

## 1. Bootstrap

| # | Item | Before | Now | Where | Notes |
|---|---|---|---|---|---|
| 1.1 | `main.ts` API entry | done | [x] | `src/main.ts` | Picks the role from `APP_ROLE` (default `api`). |
| 1.2 | `realtime.ts` entry | missing | [x] | `src/realtime.ts` | HTTP shell + `/api/v1/health` only; Socket.IO arrives with M19. |
| 1.3 | `worker.ts` entry | missing | [x] | `src/worker.ts`, `src/bootstrap/run-role.ts` | No HTTP server; queues arrive with M03. `APP_ROLE` validated in `src/config/env.validation.ts`. |
| 1.4 | helmet + compression | done | [x] | `src/app.setup.ts:53-54` | |
| 1.5 | CORS allowlist | done | [x] | `src/app.setup.ts:60` | `allowedHeaders` now includes `X-App-Version`, `X-Platform`, `X-Device-Id`. |
| 1.6 | Global prefix `/api/v1` | partial | [x] | `src/common/constants.ts`, `src/app.setup.ts:82` | |
| 1.7 | Body limit 100 kb | done | [x] | `src/app.setup.ts:55-57` | JSON and urlencoded; 413 `PAYLOAD_TOO_LARGE`. |
| 1.8 | Graceful shutdown on SIGTERM | done | [x] | `src/bootstrap/run-role.ts` | SIGTERM/SIGINT → `app.close()` (HTTP, DB, Redis) → exit 0; exit 1 after 10 s. Replaces `enableShutdownHooks()`. |

## 2. Config

| # | Item | Before | Now | Where | Notes |
|---|---|---|---|---|---|
| 2.1 | `@nestjs/config` with typed `registerAs` loaders | done | [x] | `src/config/*.config.ts`, `src/core.module.ts` | |
| 2.2 | Boot fails fast on a missing or invalid variable | done | [x] | `src/config/env.validation.ts:212` | Errors list variable names only, never values. See the defect under 12.1 for the message shown when `.env` is used. |
| 2.3 | Secrets ≥ 32 characters and different from each other (S2) | partial | [x] | `src/config/env.validation.ts:35, 246` | All three pairs of `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OTP_HASH_SECRET` must differ. |
| 2.4 | `TRUST_PROXY` required in production | missing | [x] | `src/config/env.validation.ts:232` | |
| 2.5 | Variable names match Appendix D | partial | [x] | `src/config/env.validation.ts`, `.env.example` | Every variable in use has its Appendix D name. Not defined yet because nothing reads them: `DB_REPLICA_HOST`, `ALERT_WEBHOOK_URL`, and the M06+ groups. |
| 2.6 | Loaders read validated values | partial | [x] | `src/config/*.config.ts` | Every loader reads `getValidatedEnv()`; `env.helpers.ts` is gone. |

## 3. Database

| # | Item | Before | Now | Where | Notes |
|---|---|---|---|---|---|
| 3.1 | Sequelize module, `synchronize: false` | done | [x] | `src/database/database.module.ts:49` | |
| 3.2 | Connection pool min 2, max 20 | partial | [x] | `src/database/database.module.ts:52`, `src/config/database.config.ts:6` | `DB_POOL_MIN = 2`; `DB_POOL_MAX` defaults to 20, minimum 2. |
| 3.3 | Umzug runner via `npm run migrate` | partial | [x] | `src/database/migrate.ts`, `package.json` (`migrate`, `migrate:down`, `migrate:status`, `migrate:prod`, `db:create`) | |
| 3.4 | Seeders for catalogue data | partial | [x] | `src/database/seeders/index.ts`, `npm run seed` | Runner and `sequelize_seed_meta` tracking exist; the list is empty for now. Interests stay seeded by migration `20261001000004`; prompts are M08. |
| — | Charset/collation (§4.2) | note | [x] | `src/database/database.module.ts:56`, `src/database/migrate.ts:76`, migration `20261002000001` | `utf8mb4_0900_ai_ci`; UUID columns `utf8mb4_bin`. |

## 4. Redis

| # | Item | Before | Now | Where | Notes |
|---|---|---|---|---|---|
| 4.1 | Shared ioredis client module | missing | [x] | `src/infra/redis/redis.module.ts` | Global `REDIS_CLIENT`; errors logged by name only. |
| 4.2 | BullMQ connection | missing | [x] | `src/infra/queue/queue-connection.module.ts` | Lazy; `maxRetriesPerRequest: null`; prefix `kp:queue`. |
| 4.3 | Key naming `kp:<area>:<id>` | missing | [x] | `src/infra/redis/redis-keys.ts` | `redisKey()`; `test/integration/throttler.int-spec.ts` asserts the prefix. |

## 5. Errors

| # | Item | Before | Now | Where | Notes |
|---|---|---|---|---|---|
| 5.1 | `ErrorCode` enum | partial | [x] | `src/common/exceptions/error-codes.ts` | Every Appendix C code is present (checked by diffing Appendix C against the enum). Extra codes are listed under "Not in Appendix C" below. |
| 5.2 | `AppException(ErrorCode.X, details?)` | partial | [x] | `src/common/exceptions/app.exception.ts` | Status and message come from `ERROR_DEFINITIONS`. |
| 5.3 | Global `AllExceptionsFilter` producing the §4.1 error body | partial | [x] | `src/common/filters/all-exceptions.filter.ts` | No `timestamp` or `path`; 429 always has `details.retryAfterSeconds` (line 57). |
| 5.4 | Library messages never reach clients | done | [x] | same | Also reports to Sentry (`captureException`). |

## 6. Responses

| # | Item | Before | Now | Where | Notes |
|---|---|---|---|---|---|
| 6.1 | `ResponseInterceptor` wraps into `{ success, data }` | partial | [x] | `src/common/interceptors/response.interceptor.ts` | No `timestamp`. |
| 6.2 | `meta: { nextCursor }` for lists | missing | [x] | `src/common/pagination/paginated.ts`, `response.interceptor.ts:28` | |

## 7. Logging

| # | Item | Before | Now | Where | Notes |
|---|---|---|---|---|---|
| 7.1 | pino JSON logs | done | [x] | `src/common/logging/logger.module.ts` | |
| 7.2 | Request id (`x-request-id`) | done | [x] | `src/common/http/request-id.middleware.ts`, `logger.module.ts` | |
| 7.3 | Redaction of auth headers, tokens, OTP, phone, email | done | [x] | `src/common/logging/redact.ts`, `logger.module.ts` | |
| 7.4 | Redaction depth | partial | [x] | `src/common/logging/redact.ts` (`redactDeep`), `src/common/monitoring/sentry.ts` | Any depth, case-insensitive; Sentry events go through the same redaction. |

## 8. Guards & decorators

| # | Item | Before | Now | Where | Notes |
|---|---|---|---|---|---|
| 8.1 | `JwtAuthGuard` | done | [x] | `src/auth/guards/jwt-auth.guard.ts`, `src/auth/strategies/jwt.strategy.ts` | The session lookup is still not cached in Redis (S3); that belongs with M06. |
| 8.2 | `VerifiedUserGuard` | missing | [x] | `src/common/guards/access.guards.ts:46` | Applied to routes after M11. |
| 8.3 | `RolesGuard` + `@Roles()` | missing | [x] | `src/common/guards/access.guards.ts:25`, `access.decorators.ts` | Role read from the DB-loaded principal. |
| 8.4 | `EntitlementGuard` + `@RequiresEntitlement()` | missing | [x] | `src/common/guards/access.guards.ts:61`, `src/common/entitlements/` | Free-plan stub until M21. |
| 8.5 | `@CurrentUser()` | done | [x] | `src/common/decorators/current-user.decorator.ts` | |
| 8.6 | `@ClientContext()` (IP, UA, app version, device id) | partial | [x] | `src/common/decorators/client-context.decorator.ts`, `src/common/utils/request-context.ts` | Also reads `X-Platform`. |

## 9. Rate limiting

| # | Item | Before | Now | Where | Notes |
|---|---|---|---|---|---|
| 9.1 | `@nestjs/throttler`, default 100 req / 60 s per IP | done | [x] | `src/app.module.ts:53`, `src/common/throttling/throttling.constants.ts` | |
| 9.2 | Redis storage (S4: works across instances) | missing | [x] | `src/common/throttling/redis-throttler.storage.ts` | `test/integration/throttler.int-spec.ts` runs two instances against one Redis. |
| 9.3 | Per-user limits via a custom tracker keyed by user id | missing | [x] | `src/common/guards/app-throttler.guard.ts` | |

## 10. Utilities

| # | Item | Before | Now | Where | Notes |
|---|---|---|---|---|---|
| 10.1 | UUID v7 generator | missing | [x] | `src/common/utils/uuid.ts`; `@Default(uuidv7)` on every model | The seed migration keeps `randomUUID()` because migrations that have run are never edited. |
| 10.2 | Text sanitizer | partial | [x] | `src/common/utils/sanitize.ts` | |
| 10.3 | Cursor encode/decode (base64url JSON) | missing | [x] | `src/common/utils/cursor.ts` | |
| 10.4 | HMAC helpers | partial | [x] | `src/common/utils/hmac.ts` | |
| 10.5 | Distance bucket helper | missing | [x] | `src/common/utils/distance-bucket.ts` | |

## 11. Docs & tooling

| # | Item | Before | Now | Where | Notes |
|---|---|---|---|---|---|
| 11.1 | Swagger at `/api/docs`, disabled in production | done | [x] | `src/common/swagger.ts`, `src/config/app.config.ts` | Never served by the realtime role. |
| 11.2 | Dockerfile | missing | [ ] | — | Still missing. §3.4 puts it in `docker/`. |
| 11.3 | docker-compose (MySQL, Redis, LocalStack) | missing | [x] | `docker-compose.yml`, `docker/mysql/init/`, `docker/localstack/init/` | In the code; working stack not verified (12.4). |
| 11.4 | Lint | done | [x] | `package.json` (`lint`), `oxlint.json` | |
| 11.5 | Test | done | [x] | `jest.config.ts`, `test/jest-e2e.json`, `test/jest-integration.json` | Integration tests use Testcontainers in CI. |
| 11.6 | CI pipeline (lint, type-check, unit + integration) | missing | [x] | `.github/workflows/ci.yml`, `package.json` (`typecheck`) | In the code; not yet run (12.3). |

## 12. "Done when" criteria

| # | Criterion | Status | How it was verified |
|---|---|---|---|
| 12.1 | App boots with valid env and refuses invalid env | [x] verified, with a defect | **Valid:** `npm run build`, then `node dist/main` with the local `.env` (MySQL 8.4 on 3307, Redis): logged `api ready`, `GET /api/v1/health` → 200, SIGTERM → `api stopped`, exit 0. **Invalid:** `node dist/main` with one bad variable each: `JWT_ACCESS_SECRET` of 8 chars, `PORT=abc`, production without `TRUST_PROXY`, `OTP_HASH_SECRET` equal to `JWT_ACCESS_SECRET`, `OTP_DEV_ECHO=true` in production. All five exit 1 before listening, and no secret value appears in the output. With every variable in the process environment (as in production) each run names exactly the broken rule. **Tests:** `npm test -- src/config` 25/25; `npm run test:int -- entrypoints` 5/5 (all three roles start and stop on SIGTERM; wrong `APP_ROLE` refused). **Defect:** see below. |
| 12.2 | Error and success bodies match §4.1 | [x] verified | Live against `node dist/main`: `GET /api/v1/health` → `{"success":true,"data":{…}}`; 404 unknown path, 401 protected route without a token, 400 malformed JSON, 400 validation (`details.errors`), 413 over 100 kb → each exactly `success`, `code`, `message`, optional `details`, `requestId` (no `timestamp`, `path` or library text). **Tests:** `npm run test:e2e -- app.e2e` 13/13 (exact key sets, `requestId` equals the `x-request-id` header, 429 with `details.retryAfterSeconds`); `npm test -- response.interceptor all-exceptions.filter` 8/8 (including `meta.nextCursor` for lists). |
| 12.3 | CI runs lint, type-check, unit and integration tests | **PENDING** | Pending until the branch is pushed and the GitHub Actions run is green. What was checked here: `.github/workflows/ci.yml` runs `lint`, `typecheck`, `build`, unit, integration and e2e. Each of those commands passes locally: lint exit 0, typecheck exit 0, build exit 0, unit 407/407, integration 18/18, e2e 24/24. Locally they run against Homebrew MySQL 8.4 and Redis DB 15, not the Testcontainers MySQL/Redis CI starts, and the `docker compose config` step can't run here. |
| 12.4 | `docker-compose up` gives a working local stack | **PENDING** | Pending: Docker is not installed on this machine (`docker` and `docker-compose` not found), so the stack couldn't be started. `docker-compose.yml` exists with MySQL, Redis and LocalStack services and healthchecks; CI validates the file with `docker compose config`. |

### Defect found while verifying 12.1 (not fixed; docs-only commit)

When the variables come from `.env`, a boot failure shows the wrong message. The app still refuses to start, and no values leak.

- In Nest 12, `ConfigModule.forRoot()` is `async`. When `validateEnv` throws, the error becomes a rejected promise, and `.env` is never copied into `process.env`.
- The `imports` array keeps being evaluated. `observeImports()` in `src/app.module.ts` then calls `getValidatedEnv()`, which re-validates bare `process.env`. That throws first, listing `DB_HOST`, `DB_USER`, `DB_NAME` and the three secrets as missing.
- So with a single bad variable, the message also lists variables that `.env` does set. For the cross-variable rules (`TRUST_PROXY` in production, equal secrets, `OTP_DEV_ECHO` in production) the real reason isn't shown at all.
- Production passes variables through the environment, not `.env`, so the message is correct there (verified above).
- The comment in `src/core.module.ts` ("ConfigModule.forRoot() runs when this file is imported, so .env is loaded and validated before…") states the assumption that fails.
- **Fix later:** load `.env` synchronously before validation, or make `getValidatedEnv()` read the same merged config `forRoot()` uses. Add a test that boots with one bad variable and asserts only that variable is named.

The earlier remark about `test/app.e2e-spec.ts` is resolved: it now builds the app through `configureApp()` (filter, interceptor, prefix) and asserts the wrapped bodies.

---

## Out of scope but seen

These are outside M01, so they aren't scored. Listed only so they don't get lost:

- **§3.4 folder layout:** there is no `src/infra/` or `src/modules/`. Feature modules sit directly under `src/`.
- **Stub modules:** stub feature modules are already imported in `src/app.module.ts:60-74` (discovery, matching, likes, chat, media, and others).
- **Observe module:** `@nestjs/observe` is wired in `src/app.module.ts:29-40`. The guide doesn't mention it.

---

## Implementation notes

### Not in Appendix C

These codes are in `src/common/exceptions/error-codes.ts` but not in Appendix C. They stay because existing code returns them.

| Code | HTTP | Used by |
|---|---|---|
| `INVALID_REQUEST` | 400 | Framework 400s that aren't validation errors; other client-side body-parser errors |
| `INVALID_INTERESTS` | 400 | `InterestsService.replaceForProfile` |
| `PAYLOAD_TOO_LARGE` | 413 | Body over the 100 kb limit (`body-parser-errors.middleware.ts`) |
| `INVALID_REFRESH_TOKEN` | 401 | `SessionService.rotate` |
| `NOT_FOUND` | 404 | Unknown path or wrong HTTP method |
| `PREFERENCES_NOT_FOUND` | 404 | `PreferencesService.update` |
| `PREFERENCES_ALREADY_EXIST` | 409 | `PreferencesService.create` |

### Env vars kept without an Appendix D name

These have no Appendix D equivalent, so they are unchanged: `JWT_REFRESH_EXPIRES_IN` (session lifetime moves to `SESSION_SLIDING_DAYS`/`SESSION_MAX_DAYS` in M06), `JWT_ISSUER`, `JWT_AUDIENCE`, `DB_LOGGING`, `DB_SSL`, `PROFILE_MAX_INTERESTS`, `PREFERENCES_MIN_DISTANCE_KM`, `PREFERENCES_MAX_DISTANCE_KM`, `OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET`.

Removed because nothing used them and Appendix D doesn't list them: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (production uses the IAM role), `AWS_S3_BUCKET`.

### Follow-ups outside M01

- **Mobile app:** mobile-app `EXPO_PUBLIC_API_URL` must change to `/api/v1` when this merges.
- **M06:** the auth routes are `/auth/request-otp` and `/auth/verify-otp`. The guide says `/auth/otp/request` and `/auth/otp/verify`. Rename them in M06.

### Database server: MariaDB → MySQL 8.4 LTS (2026-09-30)

The local database was XAMPP **MariaDB 10.4.28** on port 3306, not MySQL. The guide targets MySQL 8.4 LTS (§3.2), and MariaDB doesn't support what later modules need:

| Needs MySQL 8.x | Why | Module |
|---|---|---|
| `FOR UPDATE SKIP LOCKED` with MySQL's semantics | The outbox relay lets several workers take different events without blocking each other | M03 |
| Multi-valued JSON index | `dating_preferences.preferred_genders` index | M10 |
| Native `JSON` type | MariaDB's `JSON` is an alias for `LONGTEXT` with a check, so there's no binary storage and no JSON indexes | M03, M05, M10, M14… |
| `utf8mb4_0900_ai_ci` collation | Guide §4.2; MariaDB 10.4 doesn't have it | all |

Local development now uses Homebrew `mysql@8.4` (8.4.11) on **127.0.0.1:3307**, with its own data directory. MariaDB on 3306 is untouched, and no data was imported from it: the `kuchu_puchu` and `kuchu_puchu_test` databases were created fresh, and all migrations and seeders were run on them. To make this impossible to get wrong again, the app refuses to boot, and `migrate` refuses to run, unless `SELECT VERSION()` is MySQL ≥ 8.4 (`src/database/server-version.ts`).

### Collation rule

- Database, tables and all text columns are `utf8mb4_0900_ai_ci` (migration `20261002000001-convert-collation-utf8mb4-0900`).
- Exception: every `CHAR(36)` UUID id / FK column stays `utf8mb4_bin` for exact, case-sensitive matching.
- New migrations use `TABLE_OPTIONS_0900` and `uuidColumn()` from `src/database/migrations/helpers.ts`. `test/integration/schema.int-spec.ts` fails if any UUID column isn't `utf8mb4_bin`, or any other text column or table isn't `utf8mb4_0900_ai_ci`.

### Part B decisions

- **Throttler storage:** custom Redis storage (`src/common/throttling/redis-throttler.storage.ts`) using an atomic Lua script, because `@nest-lab/throttler-storage-redis` doesn't support Nest 12.
- **Rate-limit counters:** the per-IP (`default`) and per-user (`user`) budgets are global across routes. A route with its own `@Throttle()` limit gets a separate per-route counter. The per-user default is 100 / 60 s, the same as the IP limit; write endpoints set tighter `user` limits as their modules are built.
- **Per-user tracker:** the user id comes from the bearer token after its signature, expiry, issuer and audience are verified. The session row is still checked later by `JwtAuthGuard`. A forged token is never counted against the user it names.
- **UUID v7:** all new rows get v7 ids (`src/common/utils/uuid.ts`). Existing v4 ids are unchanged, so `interestIds` validation accepts both v4 and v7.
