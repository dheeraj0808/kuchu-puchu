# AUDIT-01: Backend vs. Backend Developer Guide v1.0

| | |
|---|---|
| Date | 2026-09-30 |
| Scope | `backend/` on branch `development` @ `b6837d8` (working tree clean) |
| Reference | `documentation/updated-pdf/Kuchu-Puchu-Backend-Developer-Guide.pdf` (v1.0, 30 Sep 2026). **Note:** the brief says `docs/Backend-Developer-Guide.pdf`; that path does not exist. This is the only backend guide in the repo. |
| Baseline | `npm run build` ✅ · `npm run lint` ✅ (0 warnings) · `npm test` ✅ 22 suites / 254 tests (all unit, all mocked) |
| Method | Read-only. Every source file, migration, spec and config file was read. File:line references are to the current tree. |

Legend: ✅ matches guide · ⚠️ partial / deviates · ❌ missing or violates · ➕ exists in code but not in guide

---

## 1. Module map

| Code folder | Guide module | % vs. spec | Notes |
|---|---|---|---|
| `main.ts`, `app.module.ts`, `config/`, `common/`, `database/` | **M01** Core Foundation | **~40%** | Has: helmet, compression, CORS allowlist, 100 kb body limit, shutdown hooks, typed `registerAs` config + fail-fast validation, Umzug runner, ErrorCode/AppException/AllExceptionsFilter, ResponseInterceptor, pino with request id, JwtAuthGuard, `@CurrentUser`, `@ClientContext` (IP + UA only), Swagger at `/api/docs`. Missing: `realtime.ts`, `worker.ts`, `/api/v1` prefix, Redis module, BullMQ, Redis throttler storage, per-user tracker, VerifiedUserGuard, RolesGuard + `@Roles`, EntitlementGuard, UUID v7 util, cursor util, distance-bucket util, Dockerfile, docker-compose, CI, Sentry, `src/infra/`, `src/modules/` layout. |
| `health/` | **M02** Health | **~40%** | Liveness only, at `/api/health`. No `/health/ready`. |
| — | **M03** Events, Outbox & Jobs | **0%** | No outbox table, no worker, no queues, no periodic jobs. |
| `users/` | **M04** Users | **~45%** | `findById`, `findByIdentifier`, `createVerified` exist. Status model differs from the guide (see §2). No `setStatus`, no `touchLastActive`. |
| `security/` | **M05** Security Audit | **~55%** | `record()` never throws ✅. Table has UUID PK (should be BIGINT), no `actor_user_id`, no retention job, no tests. |
| `auth/` | **M06** Auth | **~50%** | 6 of 10 endpoints, under different paths and body shapes. OTP hashing, attempts and consumption are solid. Missing: device list, revoke one session, step-up re-auth, `nextStep`, 30/90-day session model, reuse → revoke-all, SMS adapter, SMS fraud guard, Redis session cache. |
| `account/` | **M07** Account | **~25%** | `DELETE /account` exists without step-up and without the handler registry. No `data_export_requests` table, no export endpoints. |
| `interests/` (catalogue half) | **M08** Catalogue & App Config | **~15%** | Interests table (without category/icon/sort_order) plus a flat `GET /interests`. No prompts, no `app_settings`, no `SettingsService`, no `/app/config`, no Redis cache. |
| `profiles/`, `interests/` (selection half) | **M09** Profile | **~35%** | GET/POST/PATCH `/profile`, `/profile/completion`, PUT `/profile/interests`. Missing: location endpoint, prompts, public view `/profiles/:userId`, geohash, contact-detail rejection, gender-change limit, per-user rate limit, ~13 columns. |
| `preferences/` | **M10** Preferences | **~45%** | GET works with `isConfigured`. POST+PATCH instead of PUT. Schema differs (single required `relationship_intent`, no `intents`/`verified_only`/`advanced`). Range 1–500 instead of 1–200. No age-gap rule. |
| — | M11 Live Verification | 0% | No folder. |
| `media/` (empty module) | M12 Photos | 0% | Empty `@Module({})`. |
| `blocks/` (empty) | M13 Blocks | 0% | |
| `reports/` (empty) | M14 Reports | 0% | |
| `admin/` (empty) | M15 Moderation & Admin | 0% | |
| `matching/` (empty) | M16 Matches | 0% | |
| `likes/` (empty) | M17 Interactions | 0% | |
| `discovery/` (empty) | M18 Discovery | 0% | |
| `chat/` (empty) | M19 Chat & Realtime | 0% | |
| `notifications/` (empty) | M20 Notifications | 0% | |
| — | M21–M24 | 0% | No folders. |

Structural deviations (guide §3.4): modules live at `src/<name>/`, not `src/modules/<name>/`. There is no `src/infra/`. The OTP delivery port is in `auth/services/otp-delivery.service.ts`, not behind an `infra/sms` adapter. HMAC/crypto helpers are in `auth/utils/`, and the sanitizer is in `profiles/utils/`; the guide puts both in `common/`.

---

## 2. Schema diff

### 2.1 Cross-cutting checks

| Check | Result | Evidence |
|---|---|---|
| UUID **v7** CHAR(36) PKs | ❌ Column type is `DataTypes.UUID`, which on MySQL is `CHAR(36) BINARY` (acceptable). **Every id is v4**: `@Default(DataType.UUIDV4)` in all 8 models (e.g. `users/models/user.model.ts:40`) and `randomUUID()` in `auth/services/session.service.ts:68` and `database/migrations/20261001000004-seed-interests.ts:18`. | `migrations/helpers.ts:29-33` |
| BIGINT AI only for `security_events` / `outbox_events` | ❌ `security_events.id` is a UUID (`20260929000004-create-security-events.ts:20`). `outbox_events` does not exist. | |
| DATETIME(3) UTC | ✅ All timestamps are `DATE(3)` (→ `DATETIME(3)`). Sequelize `timezone: '+00:00'` (`database/database.module.ts:30`, `database/migrate.ts:53`). | |
| utf8mb4 | ✅ | `migrations/helpers.ts:11` |
| Collation `utf8mb4_0900_ai_ci` | ❌ `utf8mb4_unicode_ci` everywhere | `migrations/helpers.ts:12`, `database/database.module.ts:40`, `database/migrate.ts:55,70` |
| Soft delete only on users & profiles | ✅ `paranoid: true` only on `User` and `Profile` | `user.model.ts:32`, `profile.model.ts:38` |
| FKs `ON DELETE RESTRICT` by default | ❌ `CASCADE` on sessions, profiles, dating_preferences, profile_interests.profile_id. `SET NULL` on otp_verifications, security_events. | e.g. `20260929000003-create-sessions.ts:26`, `20260930000001-create-profiles.ts:26` |
| `users.status` enum vs. `is_banned` | ❌ See 2.2. There are three overlapping flags, and `banned` is missing from the enum. | `20260929000001-create-users.ts:26-45`, `user.model.ts:99-101` |
| One migration per change, idempotent | ✅ `tableExists` / `ensureIndexes` guards | `migrations/helpers.ts` |

### 2.2 `users` (M04)

| Column | Guide | Code | |
|---|---|---|---|
| email | VARCHAR(254) NULL UNIQUE | same | ✅ |
| phone | VARCHAR(16) NULL UNIQUE | **VARCHAR(20)** | ⚠️ |
| email_verified_at / phone_verified_at | DATETIME(3) NULL | same | ✅ |
| role | ENUM(user, moderator, admin) default user | same | ✅ |
| status | ENUM(active, suspended, **banned**, deactivated) | ENUM(active, suspended, deactivated) | ❌ `banned` missing |
| is_active | — | BOOLEAN NOT NULL default true | ➕ remove |
| is_banned | — | BOOLEAN NOT NULL default false | ➕ fold into `status='banned'` |
| suspended_until | DATETIME(3) NULL | — | ❌ |
| discovery_restricted_at | DATETIME(3) NULL | — | ❌ |
| last_login_at | DATETIME(3) NULL | same | ✅ |
| last_active_at | DATETIME(3) NULL | — | ❌ |
| deleted_at | DATETIME(3) NULL | same | ✅ |
| **Indexes** | email uq, phone uq, (status), (last_active_at) | email uq, phone uq, (status), ➕(deleted_at), ➕(created_at) | ❌ (last_active_at) missing |

`canAuthenticate()` is `isActive && !isBanned && status === 'active'` (`user.model.ts:99-101`). The guide defines it as "status is active and not deleted".

### 2.3 `otp_verifications` (M06)

| Column | Guide | Code | |
|---|---|---|---|
| user_id | — (guide has no user link) | CHAR(36) NULL FK users SET NULL | ➕ |
| identifier_hash | CHAR(64) | same | ✅ |
| channel | ENUM(sms, email) | **identifier_type** ENUM(email, phone) | ❌ name and values |
| purpose | ENUM(login, reauth) | — | ❌ |
| otp_hash | CHAR(64) | same | ✅ |
| attempts | TINYINT UNSIGNED | same, default 0 | ✅ |
| max_attempts | — | TINYINT UNSIGNED NOT NULL | ➕ |
| expires_at / consumed_at | DATETIME(3) / NULL | same | ✅ |
| request_ip | VARCHAR(45) (NOT NULL) | VARCHAR(45) **NULL** | ⚠️ |
| updated_at | **none** ("no updated_at") | present | ➕ |
| **Indexes** | (identifier_hash, created_at), (request_ip, created_at) | (identifier_hash, identifier_type, created_at), (request_ip, created_at), ➕(expires_at), ➕(user_id) | ✅ functionally |

### 2.4 `sessions` (M06)

| Column | Guide | Code | |
|---|---|---|---|
| user_id | CHAR(36) FK | same, **ON DELETE CASCADE** | ⚠️ |
| refresh_token_hash | CHAR(64) | same (+ ➕ unique index) | ✅ |
| previous_token_hash | CHAR(64) NULL | **previous_refresh_token_hash** | ⚠️ name |
| device_id | VARCHAR(100) (NOT NULL) | VARCHAR(128) **NULL** | ⚠️ |
| device_name | VARCHAR(100) | VARCHAR(128) NULL | ⚠️ |
| platform | ENUM(android, ios) | — | ❌ |
| app_version | VARCHAR(20) | — | ❌ |
| ip_address / user_agent | VARCHAR(45) / VARCHAR(255) | VARCHAR(45) / **VARCHAR(512)** | ⚠️ |
| last_used_at | DATETIME(3) (NOT NULL) | NULL | ⚠️ |
| expires_at | sliding now+30 d | fixed now+`JWT_REFRESH_EXPIRES_IN` (7 d), reset on each refresh (`session.service.ts:81,146`) | ⚠️ semantics |
| absolute_expires_at | created_at + 90 d | — | ❌ |
| reauthenticated_at | DATETIME(3) NULL | — | ❌ |
| revoked_at / revoked_reason | NULL / VARCHAR(40): logout, logout_all, replaced, reuse_detected, restricted, deleted | NULL / **VARCHAR(64)**: logout, logout_all, **replaced_by_new_login, refresh_token_reuse, account_restricted, account_deleted** (`session.service.ts:32-39`) | ⚠️ values |
| **Indexes** | (user_id, revoked_at), (user_id, device_id) | same + ➕(expires_at) + ➕refresh_token_hash unique | ✅ |

### 2.5 `security_events` (M05)

| Column | Guide | Code | |
|---|---|---|---|
| id | **BIGINT UNSIGNED AI** | CHAR(36) UUID v4 | ❌ |
| user_id | CHAR(36) NULL | same (FK SET NULL) | ✅ |
| actor_user_id | CHAR(36) NULL | — | ❌ |
| event_type | VARCHAR(64) | same | ✅ |
| ip_address / user_agent | VARCHAR(45) / VARCHAR(255) NULL | VARCHAR(45) / **VARCHAR(512)** | ⚠️ |
| metadata | JSON NULL | same | ✅ |
| created_at, no updated_at | | same | ✅ |
| **Indexes** | (user_id, created_at), (event_type, created_at) | same + ➕(created_at) | ✅ |

### 2.6 `profiles` (M09)

| Column | Guide | Code | |
|---|---|---|---|
| user_id | CHAR(36) FK UNIQUE | same, CASCADE | ⚠️ FK action |
| display_name | VARCHAR(50) (NOT NULL) | VARCHAR(50) **NULL** (for scrubbing, comment at migration :29) | ⚠️ |
| date_of_birth | DATE (NOT NULL) | DATE **NULL** | ⚠️ |
| dob_source | ENUM(self, id_verified) default self | — | ❌ |
| gender | ENUM(woman, man, non_binary, other) | same, **NULL** | ⚠️ |
| gender_changed_at / gender_change_count | DATETIME(3) NULL / TINYINT | — | ❌ |
| show_gender | BOOLEAN default true | — | ❌ |
| bio | VARCHAR(500) NULL | same | ✅ |
| occupation / education | VARCHAR(100) NULL | same | ✅ |
| relationship_intent | ENUM(long_term, short_term, casual, marriage, friends, unsure) | — (**moved to `dating_preferences`** as upper-case VARCHAR) | ❌ |
| height_cm / languages | SMALLINT NULL / JSON NULL | — | ❌ |
| latitude / longitude | **DECIMAL(6,3) / DECIMAL(7,3)** | **DECIMAL(9,6) / DECIMAL(9,6)** | ❌ (values are rounded in code, but the column keeps 6 dp) |
| geohash | CHAR(6) NULL | — | ❌ |
| city / state / country | VARCHAR(100) / VARCHAR(100) / CHAR(2) | same | ✅ |
| location_updated_at | DATETIME(3) NULL | same | ✅ |
| is_discoverable | BOOLEAN | same, default true | ✅ |
| visibility | ENUM(public, hidden) | **profile_visibility** ENUM(public, **matches_only**, hidden) | ⚠️ name, extra value |
| incognito | BOOLEAN | — | ❌ |
| completion | TINYINT UNSIGNED | **profile_completion** | ⚠️ name |
| approved_photo_count | TINYINT UNSIGNED | — | ❌ |
| face_verified_at / id_verified_at | DATETIME(3) NULL | — | ❌ |
| deleted_at | | same | ✅ |
| **Indexes** | user_id uq, (is_discoverable, visibility, deleted_at), (geohash), (date_of_birth), (gender) | user_id uq, (is_discoverable, profile_visibility, deleted_at), (date_of_birth), ➕(country,state,city), ➕(latitude,longitude), ➕(deleted_at) | ❌ (geohash), (gender) missing |

### 2.7 `interests` (M08)

| Column | Guide | Code | |
|---|---|---|---|
| name / slug | VARCHAR(50) / VARCHAR(50) UNIQUE | VARCHAR(**64**) / VARCHAR(**64**) UNIQUE | ⚠️ |
| category / icon | VARCHAR(30) / VARCHAR(50) | — | ❌ |
| is_active / sort_order | BOOLEAN / SMALLINT | is_active only | ❌ sort_order |
| **Indexes** | slug uq | slug uq, ➕(is_active, name) | ✅ |

### 2.8 `profile_interests` (M09)

| Item | Guide | Code | |
|---|---|---|---|
| PK | composite (profile_id, interest_id), **no id** | `id` UUID PK + unique(profile_id, interest_id) | ❌ |
| updated_at | none (created_at only) | present | ➕ |
| Index (interest_id) | yes | yes | ✅ |
| FK profile_id | RESTRICT | CASCADE | ⚠️ |

### 2.9 `dating_preferences` (M10)

| Column | Guide | Code | |
|---|---|---|---|
| user_id | CHAR(36) FK UNIQUE | same, CASCADE | ⚠️ |
| min_age / max_age | TINYINT UNSIGNED, 18 ≤ min ≤ max ≤ 100, **gap ≥ 2** | same types; gap rule not enforced | ⚠️ |
| preferred_genders | JSON non-empty | same | ✅ |
| max_distance_km | SMALLINT UNSIGNED, **1–200 (config)** | same type, validated 1–**500** | ⚠️ |
| relationship_intent | — | VARCHAR(32) **NOT NULL** (LONG_TERM…) | ➕ |
| intents | JSON NULL (paid) | — | ❌ |
| verified_only | BOOLEAN (paid) | — | ❌ |
| advanced | JSON NULL (paid) | — | ❌ |
| **Indexes** | user_id uq, **multi-valued index on preferred_genders** | user_id uq, ➕(relationship_intent) | ❌ |

### 2.10 Tables in guide scope M01–M10 that do not exist

`outbox_events` (M03), `data_export_requests` (M07), `prompts` (M08), `app_settings` (M08), `profile_prompts` (M09). All M11–M24 tables are also absent, which is expected at this stage.

---

## 3. API diff

**Prefix:** code uses `/api` (`main.ts:70`). The guide uses `/api/v1` (§4.1). ❌ This affects every route below.
**`/me`:** only `GET /api/auth/me` exists, and that is the guide's path ✅. There is no bare `/me` route.

| # | Code route | Guide route | Access | Body / response differences |
|---|---|---|---|---|
| 1 | `GET /api/health` | `GET /health` | Public ✅ | Returns `{success,data:{status:'ok'},timestamp}` after the interceptor. `@SkipThrottle` ✅. |
| — | — | `GET /health/ready` | Public | ❌ missing |
| 2 | `POST /api/auth/request-otp` | `POST /auth/otp/request` | Public ✅ | ⚠️ path. Body `{identifierType: email\|phone, identifier}` vs. `{channel: sms\|email, identifier}`. Throttle 5/min ✅. |
| 3 | `POST /api/auth/verify-otp` | `POST /auth/otp/verify` | Public ✅ | ⚠️ path. Body is missing `platform` and `appVersion`, `channel` is renamed, and `deviceId` is optional (guide: required). Response is `{accessToken, refreshToken, tokenType, accessTokenExpiresIn, refreshTokenExpiresAt, user}`; guide is `{accessToken, refreshToken, expiresIn, user, isNewUser, nextStep}`. Throttle 10/min ✅. |
| 4 | `POST /api/auth/refresh` | same | Public ✅ | Invalid token → `401 INVALID_REFRESH_TOKEN`; guide/App C → `UNAUTHORIZED`. Throttle 30/min is not in the guide. |
| 5 | `POST /api/auth/logout` | same | Public ✅ | Always 200 ✅ (a malformed body still returns 400). |
| 6 | `POST /api/auth/logout-all` | same | User ✅ | ✅ |
| 7 | `GET /api/auth/me` | same | User ✅ | ❌ no `nextStep`. Embeds the full own profile (➕). Exposes `status` and `role`. |
| — | — | `GET /auth/sessions`, `DELETE /auth/sessions/:sessionId`, `POST /auth/reauth/request`, `POST /auth/reauth/verify` | User | ❌ missing (4) |
| 8 | `DELETE /api/account` | same | User ✅ | ❌ no step-up (`REAUTH_REQUIRED`). Response lacks the store-subscription warning. Throttle 3/min. |
| — | — | `POST /account/export`, `GET /account/export` | User | ❌ missing |
| 9 | `GET /api/interests` | `GET /catalog/interests` | User ✅ | ⚠️ path. Flat list sorted by name vs. **grouped by category**. |
| — | — | `GET /catalog/prompts`, `GET /app/config` (Public) | | ❌ missing |
| 10 | `GET /api/profile` | same | User ✅ | ➕ embeds `interests` and `preferences`. Location is `{city,state,country,hasCoordinates,updatedAt}`; guide says `hasLocation`. Returns own `dateOfBirth`. |
| 11 | `POST /api/profile` | same | User ✅ | ✅ 201, 409 `PROFILE_ALREADY_EXISTS`. ➕ accepts `location`, `isDiscoverable`, `profileVisibility`. Underage → **400 VALIDATION_ERROR**; App C → **422 UNDERAGE**. No selfie gate yet (M11 not built). |
| 12 | `PATCH /api/profile` | same | User ✅ | `dateOfBirth` → **400** (forbidNonWhitelisted); App C → **422 PROFILE_DOB_LOCKED**. ➕ accepts `location` (guide: separate `PUT /profile/location` with a 15-min rule). No contact-detail check. No 30/h per-user limit. |
| 13 | `DELETE /api/profile` | — | User | ➕ **not in guide.** Soft-deletes the profile but keeps the account (`profiles.controller.ts:67-75`). |
| 14 | `GET /api/profile/completion` | same | User ✅ | Response `{profileCompletion, missingFields}` vs. `{score, missingFields[]}`. Weights differ (§4). |
| 15 | `GET /api/profile/interests` | — | User | ➕ not in guide (`profile-interests.controller.ts:27-32`) |
| 16 | `PUT /api/profile/interests` | same | User ✅ | ✅ atomic replace. Response `{interests, maxInterests}`. Uses `@IsUUID('4')`, **which will reject UUID v7 ids** (`update-profile-interests.dto.ts:17`). |
| — | — | `PUT /profile/location`, `PUT /profile/prompts`, `GET /profiles/:userId` (Verified) | | ❌ missing |
| 17 | `GET /api/preferences` | same | User ✅ | ✅ `isConfigured`. Hard-coded defaults 18/40/50. |
| 18 | `POST /api/preferences` | `PUT /preferences` | User | ⚠️ guide has one idempotent PUT (create or replace). |
| 19 | `PATCH /api/preferences` | — | User | ➕ |
| 20 | `GET /api/docs`, `/api/docs-json` | `/api/docs` | Swagger | ✅ disabled in prod by default |

---

## 4. Conventions

| Convention (guide) | Status | Evidence / gap |
|---|---|---|
| Success body `{success, data, meta?}` | ⚠️ | Adds `timestamp`; no way to emit `meta.nextCursor` (`common/interceptors/response.interceptor.ts:9-13,24-28`) |
| Error body `{success:false, code, message, details, requestId}` | ⚠️ | Adds `timestamp` and `path`; `requestId` is optional (`common/filters/all-exceptions.filter.ts:13-21,54-66`). Library messages don't leak ✅ (5xx → generic, `:109-112`). |
| `AppException(ErrorCode.X, details?)` | ⚠️ | Signature is `(code, message, status, details?)` (`common/exceptions/app.exception.ts:28-36`). The status is chosen at each call site instead of being mapped from the code, so the same code can drift to different statuses. |
| ErrorCode enum = Appendix C | ❌ | **Present & correct:** VALIDATION_ERROR, UNAUTHORIZED, OTP_INVALID, FORBIDDEN, ACCOUNT_RESTRICTED, PROFILE_NOT_FOUND, PROFILE_ALREADY_EXISTS, PROFILE_DOB_LOCKED, OTP_COOLDOWN, TOO_MANY_REQUESTS, OTP_DELIVERY_FAILED, INTERNAL_ERROR. **Extra (➕):** INVALID_REQUEST, NOT_FOUND, INVALID_REFRESH_TOKEN, INVALID_INTERESTS, PREFERENCES_ALREADY_EXIST, PREFERENCES_NOT_FOUND. **Missing:** REAUTH_REQUIRED, ONBOARDING_INCOMPLETE, ENTITLEMENT_REQUIRED, USER_NOT_FOUND, MATCH_NOT_FOUND, REPORT_TARGET_INVALID, PHOTO_LIMIT_REACHED, DISCOVERY_NOT_READY, INTERACTION_ALREADY_LIKED, CONTACT_EXCHANGE_PENDING, UNDERAGE, CONTACT_DETAILS_NOT_ALLOWED, PHOTO_FACE_MISMATCH, MESSAGE_CONTENT_REJECTED, CONTACT_SHARING_LOCKED, CONTACT_EXCHANGE_NOT_ALLOWED, PURCHASE_INVALID, PURCHASE_ALREADY_LINKED, CALL_NOT_ALLOWED, PHOTO_INVALID_FILE, LIKE_LIMIT_REACHED, MESSAGE_AWAITING_REPLY, VERIFICATION_ATTEMPTS_EXCEEDED, PROVIDER_UNAVAILABLE. Throttler 429s carry no `details.retryAfterSeconds`. |
| Keyset pagination, `?cursor=&limit=` default 20 / max 50 | n/a / ❌ | No list endpoints exist yet, and there is no cursor encode/decode utility (M01). |
| Global ValidationPipe whitelist + forbidNonWhitelisted + transform | ✅ | `common/pipes/validation.pipe.ts:4-12`; values never echoed ✅ |
| Controllers never touch models | ✅ | No controller imports a model or `@InjectModel` |
| Response DTOs via `fromModel()` | ✅ | `UserResponseDto.fromModel`, `ProfileResponse.fromModel`, `PreferencesResponse.fromModel`, `InterestResponse.fromModel`. No model is returned directly. |
| userId only from token | ✅ | Every service method takes `user.userId` from `@CurrentUser()`. Tested: `preferences.controller.spec.ts:108`, `profiles.controller.spec.ts:93`. |
| Use-case service owns the transaction | ✅ | `auth.service.ts:130`, `account.service.ts:36`, `profiles.service.ts:101,133` |
| Modules talk via exported services/events; deletion via registry | ⚠️ | `AccountService` imports Auth, Profiles, Preferences and Users directly (`account/account.module.ts:11`); the guide requires an `AccountDeletionHandler` registry. No events exist. |
| Client headers X-App-Version, X-Platform, X-Device-Id | ❌ | CORS allows only `X-Device-Id` (`main.ts:61-66`); `@ClientContext` returns IP + UA only (`client-context.decorator.ts:8-15`) |
| Every endpoint has Swagger decorators | ✅ | |
| Commit style `feat(M17): …` | ⚠️ | History uses `feat(profiles): …` / `feat: …` (no module codes) |

---

## 5. Security baseline S1–S12

| # | Verdict | Evidence |
|---|---|---|
| **S1** Authz in service; not-allowed → 404 | ✅ (current scope) | All reads and writes are own-resource and keyed by the token userId (`profiles.service.ts:50-53`, `preferences.service.ts:20`). No cross-user endpoints exist yet. |
| **S2** No secrets at rest; HMAC; ≥ 32 chars; distinct | ⚠️ | **OTP:** HMAC-SHA256 of `otp:<identifierHash>:<code>` (`auth/services/otp.service.ts:44-50,129`); identifier stored only as HMAC ✅. **Refresh:** HMAC with `JWT_REFRESH_SECRET` (`auth/services/token.service.ts:65-67`, `session.service.ts:74`) ✅. **Constant-time:** `timingSafeEqualHex` (`auth/utils/crypto.util.ts:26-34`) used for OTP (`otp.service.ts:191`) and refresh (`session.service.ts:107-110,184`) ✅. CSPRNG OTP ✅ (`crypto.util.ts:7-16`). **Gap:** only access ≠ refresh is checked (`config/env.validation.ts:191-193`); `OTP_HASH_SECRET` may equal either. |
| **S3** JWT sig/exp/iss/aud + session row (Redis-cached, deleted on revoke); role from DB | ⚠️ | JWT checks ✅ (`auth/strategies/jwt.strategy.ts:35-42`). Session row checked on every request ✅ (`:50-57`). Role from DB ✅ (`:58-59`). **Gaps:** no Redis cache, so every request costs a DB join (`session.service.ts:213-218`); restricted users get **401 UNAUTHORIZED**, not 403 ACCOUNT_RESTRICTED (`auth/guards/jwt-auth.guard.ts:10-14`). The token carries a `role` claim the guide doesn't list, and the strategy rejects tokens without it (`jwt.strategy.ts:23-24`). |
| **S4** Global per-IP + per-user write limits, in Redis | ❌ | In-memory throttler, with a TODO in the code (`app.module.ts:55-56`). No per-user tracker. Profile, preferences and interest writes have no per-user limit (guide: 30 profile updates/h). |
| **S5** Never expose coords, exact distance, DOB, email, phone, flags, moderation state | ✅ (current scope) | Coordinates never serialized; only `hasCoordinates` (`profiles/dto/profile.response.ts:48-58`), tested at `profiles.service.spec.ts:99`. Email, phone, DOB, status and role are returned **only to their owner**. Revisit when the public view (M09) lands. |
| **S6** Hostile uploads | n/a | No upload endpoints |
| **S7** Verified webhooks | n/a | None |
| **S8** Store-verified purchases | n/a | None |
| **S9** Separate admin surface, RolesGuard | n/a / ❌ | No admin routes. RolesGuard and `@Roles` don't exist yet (M01). |
| **S10** Audit via `record()`, never throws, no raw PII | ⚠️ | Never throws ✅ (`security/security-events.service.ts:29-47`). `identifierHashPrefix` (12 chars) is used in auth ✅ (`auth.service.ts:51`). **Gap:** account deletion stores **full 64-char** identifier hashes in metadata (`account/account.service.ts:43-46,62`); M05 says "12-char HMAC prefix". No test covers `SecurityEventsService`. |
| **S11** TLS, encryption at rest | ⚠️ | DB TLS is opt-in via `DB_SSL` (`database.module.ts:45`) and not enforced in production. Infra isn't in the repo. |
| **S12** Lockfile, CI vuln scan, justified deps | ⚠️ | `package-lock.json` is committed ✅. No CI or scanning. `@nestjs/observe` (runtime, `app.module.ts:29-40`) and `@nestjs/mau` (dev) are not in the guide's stack and have no stated reason. |

### 5.1 Specific verifications

| Check | Verdict | Detail |
|---|---|---|
| OTP & refresh stored only as HMAC; constant-time compare | ✅ | See S2. Attempts are reserved atomically before the compare (`otp.service.ts:174-188`). Consumption is a conditional update (`:201-208`). Refresh rotation is a conditional update on the old hash (`session.service.ts:155-162`). |
| Identical OTP responses for unknown / known / banned | ❌ **(enumeration oracle)** | The first response is byte-identical (`auth.service.ts:55-65`, tested `auth.service.spec.ts:67`). **But a restricted identifier returns early, before `otp.issue()`** (`auth.service.ts:56-65`), so: **(a)** a second request within 60 s gets `429 OTP_COOLDOWN` for unknown or known users (`otp.service.ts:76-88`) but `200` for banned ones; **(b)** hourly caps never trigger for banned identifiers; **(c)** in production, delivery always throws (`auth/services/otp-delivery.service.ts:31-34`), so unknown and known get `503 OTP_DELIVERY_FAILED` while banned get `200`; **(d)** the banned path skips 4–5 queries and delivery, so timing differs. Separately, verify returns **403 ACCOUNT_RESTRICTED** after a valid code (`auth.service.ts:165-173`), while the guide says every verify failure is `401 OTP_INVALID`. |
| Coordinates rounded to 3 dp **before** storage; geohash populated | ⚠️ | Rounded before write ✅ (`profiles/profiles.service.ts:28-44`, tested `profiles.service.spec.ts:87-99`). But the columns are DECIMAL(9,6) (`20260930000001-create-profiles.ts:39-40`) and there is **no geohash column** and no geohash computation. |
| No PII in logs (pino redaction) | ⚠️ | `common/logging/logger.module.ts:12-27` redacts auth/cookie headers and the whole `req.body` ✅; the request serializer strips query strings ✅ (`:63-70`). **Gaps:** (1) the wildcard paths `*.otp`, `*.phone`, `*.email`, `*.identifier`… only match **one level below a top-level key**, not top-level keys (e.g. `logger.warn({ identifier })`) and not deeper nesting; (2) with `DB_LOGGING=true`, Sequelize logs SQL with **inlined WHERE values** (email and phone lookups), which contradicts the comment at `database.module.ts:48`; (3) `DevOtpDeliveryService` logs the masked identifier (`otp-delivery.service.ts:39-42`), which is partial PII; (4) no log-scan test (App E). The dev-only OTP stdout echo is gated by `OTP_DEV_ECHO` and refused in production ✅ (`env.validation.ts:182-184`). |
| Contact-detail detection in bio / name (`CONTACT_DETAILS_NOT_ALLOWED`) | ❌ | Not implemented and no error code exists. Bio is only sanitized (`profiles/dto/profile.fields.ts:94-101`). `SHORT_TEXT_REGEX` for occupation/education allows digits, `+` and `#` (`:31`). Display name blocks digits and `@` only as a side effect of its regex (`:29`). |

### 5.2 Other correctness findings

| Finding | Severity | Evidence |
|---|---|---|
| Refresh-token reuse revokes **only that session**; the guide says revoke **all** of the user's sessions and send a security alert. The test asserts the current (wrong) behaviour. | High | `session.service.ts:112-126`, `session.service.spec.ts:90` |
| Concurrent registration fallback re-reads inside the same REPEATABLE READ transaction. The consistent snapshot predates the competing commit, so the re-read can return `null` and the request fails with a 500. In practice this is mitigated because one OTP can only be consumed once, but the M04 "Done when" race is not guaranteed. | Medium | `auth.service.ts:131-140` |
| No SMS/email provider adapter. In production every OTP request returns 503. | High (launch blocker) | `otp-delivery.service.ts:31-34` |
| `TRUST_PROXY` not required in production (M01), so the per-IP throttle and OTP IP cap key on the load-balancer IP. | Medium | `env.validation.ts:41-43` |
| e2e test re-implements bootstrap (`setGlobalPrefix('api')`, no filter or interceptor) and asserts an unwrapped body the real app never returns. It also needs a live DB. | Medium | `test/app.e2e-spec.ts:16,24` |

---

## 6. Hard-coded values that belong in `app_settings` or env

| Value | Where | Target (per guide) |
|---|---|---|
| OTP per-IP cap `20` / h | `auth/services/otp.service.ts:13` | env `OTP_MAX_PER_IP_PER_HOUR` (App D) |
| Global throttle 100 / 60 s | `app.module.ts:56` | config (M01 default) |
| Route throttles 5/min, 10/min, 30/min, 3/min | `auth/auth.controller.ts:36,47,58`, `account/account.controller.ts:22` | config / app_settings |
| Session lifetime `7d` fixed | `config/jwt.config.ts:20`, `.env.example` | env `SESSION_SLIDING_DAYS=30`, `SESSION_MAX_DAYS=90` |
| Completion weights and `MIN_INTERESTS_FOR_COMPLETION = 3` | `profiles/profile-completion.service.ts:15,23-36` | app_settings (and weights must change to the guide's) |
| Max interests `10` (**currently env** `PROFILE_MAX_INTERESTS`) | `config/env.validation.ts:137-140`, `config/profile.config.ts:14` | app_settings (App D: product limits are not env) |
| Preference distance range `1–500` (**currently env**) | `config/env.validation.ts:142-149`, `config/profile.config.ts:15-16` | app_settings, default **1–200** |
| Default distance `50` | `preferences/preferences.service.ts:14` | app_settings |
| Default age range `18–40` | `preferences/dto/preferences.response.ts:38-39` | app_settings |
| Dating age `18–100` | `profiles/profile.constants.ts:2-4` | 18 is a legal floor (could stay constant); 100 → app_settings |
| Interest hard cap `50`, distance hard cap `20000` | `interests/dto/update-profile-interests.dto.ts:5`, `preferences/dto/preference.fields.ts:22` | Defensive DTO caps; acceptable as constants |
| DB pool `min 0`, default `max 10` | `database/database.module.ts:36`, `config/database.config.ts:24` | M01: min 2, max 20 |

Env naming vs. Appendix D: `DB_USERNAME`/`DB_DATABASE` (guide `DB_USER`/`DB_NAME`), `JWT_ACCESS_EXPIRES_IN` (`JWT_ACCESS_TTL`), `JWT_REFRESH_EXPIRES_IN` (`SESSION_*`), `OTP_MAX_REQUESTS_PER_HOUR` (`OTP_MAX_PER_HOUR`), `REDIS_HOST/PORT/PASSWORD` (`REDIS_URL`, `REDIS_TLS`), `FIREBASE_*` (`FCM_*`), `AWS_ACCESS_KEY_ID/SECRET` (guide: IAM role, no keys in prod), `AWS_S3_BUCKET` (`S3_BUCKET_MEDIA`/`S3_BUCKET_PRIVATE`). Missing: `APP_ROLE`, `DB_REPLICA_HOST`, `OTP_MAX_PER_IP_PER_HOUR`, `OTP_SMS_ALLOWED_COUNTRIES`, all SMS/Email, `SENTRY_DSN`, `ALERT_WEBHOOK_URL`. Not in guide: `JWT_ISSUER`, `JWT_AUDIENCE` (reasonable), `DB_LOGGING`, `DB_SSL`, `OBSERVE_*`.

---

## 7. Tests

**Shape:** 22 suites, 254 tests, all unit tests with mocked models. Controller specs spin up Nest with fakes. There is **no integration test against real MySQL or Redis**, no Testcontainers dependency, and one e2e test (health). No coverage threshold is configured.
**Environment note:** Docker is **not installed** on this machine, so Testcontainers cannot run here as-is. MySQL and Redis are installed via Homebrew.

### 7.1 "Done when" coverage (M01–M10)

| Module | Done-when item | Covered? |
|---|---|---|
| M01 | App refuses invalid env | ✅ `config/env.validation.spec.ts` |
| M01 | Error and success bodies match 4.1 | ⚠️ codes asserted in controller specs; shape not asserted, and the shape doesn't match anyway |
| M01 | CI runs lint, type-check, unit + integration | ❌ no CI |
| M01 | `docker-compose up` gives a working stack | ❌ no compose file |
| M02 | Health excluded from limits and auth; ready → 503 when DB down | ❌ |
| M03 | All three outbox tests | ❌ (no M03) |
| M04 | Identifiers normalised before every lookup | ✅ `auth/dto/dto-validation.spec.ts` (DTO); service-level normalise tested indirectly |
| M04 | Concurrent registration with same phone → exactly one user | ❌ |
| M05 | Every auth action records an event | ⚠️ spot-checked in `auth.service.spec.ts` |
| M05 | Failing insert never breaks the request | ❌ no `security-events.service.spec.ts` |
| M06 | No plaintext OTP/token in DB | ✅ `otp.service.spec.ts:49`, `session.service.spec.ts:57` · logs ❌ |
| M06 | Race: two verifies of one code | ⚠️ mocked only (`otp.service.spec.ts:172,181`) |
| M06 | Race: two refreshes of one token | ⚠️ mocked only (`session.service.spec.ts:137`) |
| M06 | Reuse detection revokes **all** sessions | ❌ the test asserts single-session revoke |
| M06 | Banned user gets identical OTP response | ⚠️ first request only (`auth.service.spec.ts:67`); the cooldown oracle is untested |
| M07 | One failing handler rolls back the whole deletion | ⚠️ mocked (`account.service.spec.ts:163`); no registry |
| M07 | Same phone can re-register with new id | ❌ |
| M07 | Export has own data only | ❌ |
| M08 | Seeders create interests and prompts; setting change within one cache refresh | ⚠️ interests seeded by migration; ❌ prompts, settings |
| M09 | Under-18 rejected at create | ✅ `profiles/dto/profile-dto.spec.ts:49` (400, guide wants 422 UNDERAGE) |
| M09 | Coordinates never in any response | ✅ `profiles.service.spec.ts:99` (service-level only; no response-wide scan) |
| M09 | Public view identical 404 for blocked/hidden/missing | ❌ (no public view) |
| M10 | Invalid ranges rejected with clear messages | ✅ `preferences.dto.spec.ts`, `preferences.service.spec.ts:153-209` |
| M10 | Advanced fields blocked on Free | ❌ |

### 7.2 Race tests against real MySQL

| Race | Exists? |
|---|---|
| Two verifies of one OTP | ❌ (mock that simulates `affectedRows=0` only) |
| Two refreshes of one token | ❌ (mock only) |
| Concurrent registration with the same phone | ❌ (none; and see the §5.2 snapshot issue) |

---

## 8. Prioritised fix list

Effort is for one developer and includes tests. "Sprint" marks items covered by the proposed Part 2 tasks T1–T6.

### Critical

| # | Fix | Guide | Effort | Sprint |
|---|---|---|---|---|
| C1 | Shared Redis module (`kp:<area>:<id>`), `REDIS_URL`/`REDIS_TLS`, Redis-backed throttler, per-user tracker | M01, S4, §3.2 | 1.5 d | T1 |
| C2 | Single `users.status` incl. `banned`; drop `is_banned` and `is_active` with data migration; add `suspended_until`, `discovery_restricted_at`, `last_active_at` + indexes; `canAuthenticate()`; guard → 403 `ACCOUNT_RESTRICTED` | M04, S3, App C | 1.5 d | T3 |
| C3 | Session state cached in Redis, evicted on every revoke path | S3 | 1 d | T3 |
| C4 | Outbox table, `OutboxService.publish(…, tx)`, `worker.ts`, 1 s relay with `FOR UPDATE SKIP LOCKED`, BullMQ with backoff (max 8), idempotent handlers, repeatable jobs (App B) | M03 | 3 d | T5 |
| C5 | Close the OTP enumeration oracle: run cooldown and caps for every identifier *before* the restricted check, return identical 200 on delivery failure for all or none, equalize the work path; verify returns `401 OTP_INVALID` for all failures | M06 "No enumeration" | 0.5 d | ❌ not in T1–T6 |
| C6 | Refresh-token reuse → revoke **all** user sessions + `auth.token_reuse` event | M06 | 0.5 d | ❌ not in T1–T6 |
| C7 | SMS/email adapters in `src/infra/` with fakes; country allowlist `+91`; daily SMS budget. Without these, prod OTP is always 503. | M06, §4.4 | 1.5 d (+ vendor) | ❌ |

### High

| # | Fix | Guide | Effort | Sprint |
|---|---|---|---|---|
| H1 | Global prefix `/api/v1`; Swagger, e2e, Postman; logger health-ignore path | §4.1 | 0.5 d | T2 |
| H2 | `GET /health` + `GET /health/ready` (MySQL + Redis, 1 s, 503) | M02 | 0.5 d | T4 |
| H3 | `app_settings` + `SettingsService.get<T>()` with per-key schema and 10-min Redis cache; prompts table + `GET /catalog/prompts`; `GET /app/config`; `GET /catalog/interests` grouped (needs category/icon/sort_order); move §6 values into seeds; distance 1–200 | M08, M10, §1 | 2.5 d | T6 |
| H4 | UUID v7 generator in `common/`; switch all model defaults and `randomUUID()`; relax `@IsUUID('4')` | §4.2 | 0.5 d | ❌ (blocker for T5/T6 ids, see Q4) |
| H5 | Contact-detail detector (normalised digits, spelled-out numbers, email, UPI, handles) on bio, name, prompts → 422 `CONTACT_DETAILS_NOT_ALLOWED` | M09 | 1.5 d | ❌ |
| H6 | Coordinates → DECIMAL(6,3)/(7,3) + `geohash CHAR(6)` + index; `PUT /profile/location` with 15-min rule | M09 | 1 d | ❌ |
| H7 | Body shapes: drop `timestamp`/`path`, add `meta`; align ErrorCode with Appendix C; `AppException(code, details?)` with a central code → status map; `retryAfterSeconds` on 429 | §4.1, App C | 1 d | ❌ |
| H8 | PII in logs: root-level and nested redaction paths, no inlined SQL values, drop masked-identifier logs, add a log-scan test | §4.4, S10, App E | 0.5 d | ❌ |
| H9 | Integration test harness on real MySQL + Redis (Testcontainers or local services, see Q7), plus the three race tests; fix the registration re-read (locking read) | App E, M04, M06 | 1.5 d | partial (T5 needs it) |
| H10 | `security_events`: BIGINT AI PK, `actor_user_id`, `user_agent` 255; 12-char hash prefixes only | M05 | 0.5 d | ❌ |
| H11 | Collation → `utf8mb4_0900_ai_ci` (new migration converting all tables + DB default) | §4.2 | 0.5 d | ❌ |
| H12 | Sessions: 30-day sliding + 90-day absolute, `platform`, `app_version`, `reauthenticated_at`, guide revoke-reason values | M06 | 1 d | next sprint (M06) |
| H13 | Account deletion: step-up `REAUTH_REQUIRED`; `AccountDeletionHandler` registry | M07, §3.5 | 1 d | next sprint (M06/M07) |

### Medium

| # | Fix | Guide | Effort |
|---|---|---|---|
| M1 | Auth route and body renames (`/auth/otp/request`, `/auth/otp/verify`, `channel: sms\|email`, required device fields); verify response `expiresIn`, `isNewUser`, `nextStep`; `/auth/me` `nextStep`; sessions list/revoke; reauth endpoints | M06 | 2 d |
| M2 | `otp_verifications`: `channel`, `purpose`; drop `user_id`, `max_attempts`, `updated_at` | M06 | 0.5 d |
| M3 | Preferences: single `PUT`, add `intents`/`verified_only`/`advanced`, drop `relationship_intent` (move to profiles), gap ≥ 2, multi-valued index | M10 | 1 d |
| M4 | Profile schema: `dob_source`, `show_gender`, `relationship_intent`, `height_cm`, `languages`, `incognito`, `approved_photo_count`, `face_verified_at`, `id_verified_at`, gender-change columns + 2-per-30-days rule; `visibility` enum without `matches_only`; rename `completion`; `(gender)` index; 30/h per-user limit | M09 | 1.5 d |
| M5 | Completion weights exactly per guide (photos 25, bio 15, prompts 10, interests 10, name 5, DOB 5, gender 5, location 10, occupation 5, education 5, ID 5) and `{score, missingFields}` | M09 | 0.5 d |
| M6 | Decide on extra routes: `DELETE /profile`, `GET /profile/interests`, `POST`/`PATCH /preferences` (see Q3) | §4.1 | 0.25 d |
| M7 | `422 UNDERAGE` at create; `422 PROFILE_DOB_LOCKED` on PATCH dob | App C | 0.25 d |
| M8 | FK actions → `RESTRICT`; deletion done by services | §4.2 | 0.5 d |
| M9 | `profile_interests` composite PK, drop `id` and `updated_at` | M09 | 0.25 d |
| M10 | Env names and set per Appendix D; `TRUST_PROXY` required in prod; `OTP_HASH_SECRET` distinct; `DB_POOL` min 2 / max 20 | App D, M01 | 0.5 d |
| M11 | Client headers `X-App-Version`, `X-Platform` in CORS and `@ClientContext` | §4.1 | 0.25 d |
| M12 | Guards and utils: VerifiedUserGuard, RolesGuard + `@Roles`, EntitlementGuard + stub; cursor and distance-bucket utils | M01 | 1 d |
| M13 | Layout `src/modules/`, `src/infra/`; `realtime.ts` | §3.4 | 0.5 d |
| M14 | Dockerfile, CI (lint, type-check, unit, integration, `npm audit`), Sentry | M01, S12 | 1 d |
| M15 | One shared `configureApp()` used by `main.ts` and e2e tests | App E | 0.25 d |
| M16 | Justify or remove `@nestjs/observe` and `@nestjs/mau` | S12 | 0.1 d |

---

## 9. Open questions to resolve before Part 2

The Part 2 rules say to stop and ask when the guide is ambiguous or conflicts with the code. These came up during the audit:

1. **Health path (T4).** The guide lists `GET /health` in a document whose base path is `/api/v1`. Should health be `/health` (outside the prefix, typical for load balancers) or `/api/v1/health`?
2. **T3 data migration.** Proposed mapping: `is_banned=1` → `banned`; `deleted_at IS NOT NULL` → `deactivated`; `is_active=0` → `deactivated`; else keep `status`. Should `is_active` be dropped together with `is_banned`? The guide has a single status field.
3. **Extra routes.** Keep, remove, or deprecate `DELETE /profile`, `GET /profile/interests`, and `POST`/`PATCH /preferences` (the guide has `PUT /preferences` only)? T2 touches every route, so this is the cheapest moment to decide.
4. **UUID v7.** New tables in T5/T6 should use v7. Should the sprint also switch existing models to v7 for new rows (existing v4 ids stay)? It's small, but it's not in T1–T6.
5. **Hard-coded throttle limits (T6).** The `@Throttle` values are decorator constants. Moving them to `app_settings` means a custom throttler guard that reads settings per request. Do this in T6, or keep throttles in config/env and move only product limits?
6. **Which limits go to `app_settings` vs. env (T6).** Appendix D lists OTP limits as env vars. Proposal: OTP and session values stay env; interests max, distance range and defaults, completion weights and age defaults move to `app_settings`. OK?
7. **Integration tests without Docker.** Testcontainers needs Docker, which isn't installed here. Options: (a) install Docker Desktop or Colima; (b) run integration tests against local MySQL and Redis via `TEST_DB_*`/`TEST_REDIS_URL`, with Testcontainers in CI. T5 requires real-MySQL tests.
8. **T5 "move existing cleanup work".** There is currently **no** cleanup code for OTPs, sessions or security events, so these will be new BullMQ repeatable jobs. Please confirm.
9. **T2 Postman.** No Postman collection exists. Create `docs/postman/kuchu-puchu.postman_collection.json` from the OpenAPI spec?
10. **Out-of-sprint critical items.** C5 (OTP enumeration oracle) and C6 (reuse → revoke-all) are security bugs but not in T1–T6. Add them to this sprint (about 1 d total) or leave them for the M06 sprint?
11. **Collation, `security_events` BIGINT, FK actions** (H10, H11, M8). These are schema fixes outside T1–T6. Defer to the next sprint?
12. **Guide location.** Should the PDF be copied to `backend/docs/Backend-Developer-Guide.pdf` so the brief's path is valid?
