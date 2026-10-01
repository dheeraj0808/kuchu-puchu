# M08 Catalogue & App Config: gap checklist

| | |
|---|---|
| Date | 2026-10-01 |
| Spec | Guide §8 M08; Appendix C; Appendix D ("product limits are not env variables"); Definition of Done ("config keys added to app_settings seed") |
| Scope | M08 as specified, plus the owner's decisions: typed settings registry, `SettingsService.get` / `set`, the seeded keys, limits moved out of env, the three endpoints with Redis caching, removal of the old interests route, maintenance / force-update exposed only |
| Key | **done** · **partial** · **missing** (before) → [x] after |

Paths are relative to `backend/`. "Before" is the code at `f57bac3`.

## Tables

| # | Spec item | Before | After | Where / how verified |
|---|---|---|---|---|
| T1 | `interests`: `name` / `slug` VARCHAR(50) / VARCHAR(50) UNIQUE, `category` VARCHAR(30), `icon` VARCHAR(50), `is_active` BOOLEAN, `sort_order` SMALLINT | **partial**: name / slug VARCHAR(64), no category, icon or sort_order | [x] | Migration `20261009000001-align-interests`; `catalog.int-spec.ts` "interests matches the spec…" |
| T2 | `prompts`: `text` VARCHAR(150), `category` VARCHAR(30), `is_active`, `sort_order` | **missing** | [x] | Migration `20261009000002`; "prompts matches the spec" |
| T3 | `app_settings`: `key` VARCHAR(64) PK, `value` JSON, `updated_by` CHAR(36) NULL, `updated_at`; no id | **missing** | [x] | Migration `20261009000003`; "app_settings is exactly the spec…" |

## Endpoints (under `/api/v1`)

| # | Endpoint | Before | After | Where / how verified |
|---|---|---|---|---|
| E1 | `GET /catalog/interests` (User): active interests grouped by category | **partial**: `GET /interests`, a flat list by name | [x] | `catalog.controller.ts`; "GET /catalog/interests: active interests grouped by category, in sort order; needs a token" (an inactive interest is hidden) |
| E2 | `GET /catalog/prompts` (User): active prompts | **missing** | [x] | "GET /catalog/prompts: about 20 active prompts…" |
| E3 | `GET /app/config` (Public): min version per platform, maintenance, public feature flags, support links | **missing** | [x] | "GET /app/config works without a token and shows only the public settings" |
| E4 | All three cached in Redis for 10 min, invalidated when a setting changes | **missing** | [x] | `catalog.service.ts` (`kp:catalog:interests`, `kp:catalog:prompts`, `kp:app-config:v1`, TTL 600); `set()` drops them; "a changed setting is served from the cache until set() invalidates it…" |
| E5 | Old `GET /interests` removed | — | [x] | `interests.controller.ts` deleted; "the old GET /interests route is gone" (404 `NOT_FOUND`); unit spec in `profile-interests.controller.spec.ts` |

## Rules and owner decisions

| # | Rule | After | Where / how verified |
|---|---|---|---|
| R1 | `SettingsService.get<T>(key)` reads a typed registry: each key has a schema and a default; an unknown key fails at startup | [x] | `settings.registry.ts` (`SETTINGS`, parsers, defaults); `get` only accepts registry keys (compile time); `onModuleInit` refuses a stored row with an unknown key ("a stored key this build does not know fails the boot", unit + integration). A stored value that no longer parses is logged and the default used |
| R2 | `SettingsService.set(key, value, actorUserId)` validates, writes, records a security event and deletes the cache key | [x] | Per-key parser + cross-key rules (min ≤ default ≤ max distance) → 400 `VALIDATION_ERROR`; upsert with `updated_by`; `admin.setting_changed` (`{key, from, to}`, strict, in the write transaction; kept 3 years as `admin.*`); drops the settings, app-config and catalogue caches. Unit "set: validates, writes, audits…", integration "an invalid value is rejected…" |
| R3 | "The only way code reads tunable limits" | [x] | `InterestsService.maxInterests()`, `PreferencesService` distances, `ProfilesService` completion threshold all read `SettingsService` |
| R4 | Seeded keys: `profile.max_interests` (10), `preferences.min_distance_km` (1), `preferences.max_distance_km` (200), `app.min_version.android`, `app.min_version.ios` (1.0.0), `app.maintenance` (false), public feature flags, support links | [x] | Seeder `20261009000003-app-settings` (registry defaults). Feature flags: `app.feature_flags {voiceVideoCalls, contactExchange, idVerification}`, all false. Support links: `app.support_links {helpCenterUrl, privacyPolicyUrl, termsUrl, supportEmail}`, null until an admin sets them (no URLs invented) |
| R5 | `PROFILE_MAX_INTERESTS`, `PREFERENCES_*_DISTANCE_KM` removed from env, config and `.env.example` | [x] | `env.validation.ts`, `config/profile.config.ts` deleted, `.env.example`; Appendix D: "product limits … live in app_settings" |
| R6 | Other hard-coded product limits moved into settings and listed here | [x] | See "Product limits" below |
| R7 | Seeders: interests aligned, about 20 prompts; seeders upsert so re-running is safe | [x] | `20261009000001-interests` (by slug), `20261009000002-prompts` (by text), settings insert-only. "are idempotent: a second run inserts nothing and duplicates nothing", "upsert: catalogue rows follow the seed list, but a retired interest stays retired and an admin setting is kept" |
| R8 | Preferences reject a distance > 200 | [x] | "preferences reject a distance over 200" (400 with the range, 200 accepted) |
| R9 | Maintenance mode and force-update exposed in `/app/config` only; no request blocking | [x] | Decision, see below |
| R10 | "Changing a setting takes effect within one cache refresh" (Done when) | [x] | Through `set()` immediately (caches dropped); a direct DB change within 10 minutes |
| R11 | "Seeders create interests and prompts" (Done when) | [x] | 25 interests in 5 categories, 20 prompts in 5 categories |

## Product limits

Searched every `const NAME = <number>`, validator bound and config default in `src/`.

**Moved into settings**

| Setting | Was | Used by |
|---|---|---|
| `profile.max_interests` (10) | env `PROFILE_MAX_INTERESTS` | `InterestsService.replaceForProfile`, `GET /profile/interests` (`maxInterests`) |
| `preferences.min_distance_km` (1) / `preferences.max_distance_km` (200; was 500) | env `PREFERENCES_MIN/MAX_DISTANCE_KM` | `PreferencesService` validation and defaults |
| `preferences.default_distance_km` (50) | `DEFAULT_DISTANCE_KM` in `preferences.service.ts` | `GET /preferences` before the user saves any |
| `profile.min_interests_for_completion` (3) | `MIN_INTERESTS_FOR_COMPLETION` in `profile-completion.service.ts` | Completion score. Stored `profile_completion` values pick up a change on the profile's next write |

**Kept as code, with the reason**

| Constant | Why it is not a setting |
|---|---|
| `MIN_DATING_AGE` 18, `MAX_DATING_AGE` 100 | Legal minimum / sanity bound, not a product choice |
| `DISPLAY_NAME_*`, `BIO_MAX`, `OCCUPATION_MAX`, `EDUCATION_MAX`, `PLACE_NAME_MAX` | Bound to column sizes |
| `INTEREST_IDS_HARD_CAP` 50, `DISTANCE_HARD_MAX_KM` 20,000 | Request-shape guards; the settings' own upper bounds |
| `REAUTH_WINDOW_MS` 10 min, export window 24 h, link 24 h, URL 15 min, `EXPORT_MAX_FAILED_PER_WINDOW` 3 | Fixed by the guide (M06, M07) or security rules, not tunable by admins |
| OTP / session / SMS / email limits | Env variables listed in Appendix D (security controls, not product limits) |
| `SESSION_LIST_LIMIT` 50, batch sizes, timeouts, retention days | Operational, not product limits |

## Decisions and deviations

- **Maintenance and force-update are not enforced by the API.** `/app/config` tells the app; the app shows the maintenance screen or the update prompt. Blocking requests in the API would also block the admin and the health checks, and an old app that ignores the flag still talks to a backward-compatible `/api/v1`. If enforcement is ever needed, a guard can read the same settings.
- **One cached entry for all settings** (`kp:settings:all`, 10 min). Redis down → MySQL, then registry defaults.
- **`set()` also drops the catalogue caches** (the spec: "all three … invalidated when an admin changes a setting"). Catalogue rows changed by a seeder show within 10 minutes; there is no admin catalogue API yet.
- **`prompts.text` is unique** (not in the spec) so the seeder can upsert by it. Rewording a prompt adds a new row; retire the old one with `is_active = false`.
- **Indexes:** `interests (is_active, sort_order)` replaces `(is_active, name)`; `prompts (is_active, sort_order)`. The spec lists only the slug unique key; these serve the catalogue reads.
- **`npm run seed` now runs every seeder every time** (no run-once record), because each one upserts. The old `sequelize_seed_meta` table is no longer written.
- **The settings seeder only inserts missing keys**: it never overwrites a value an admin set. The catalogue seeders do update name / category / icon / order, but never `is_active` of an existing row.
- **No admin API** (M15 adds `PUT /admin/settings/:key` on top of `set()`).
- **`preferences.max_distance_km` is now 200** (env default was 500), as decided. Existing preferences above 200 keep their stored value until the next update, which then has to be ≤ 200.
- **Interest icons** are names from the app's icon set (e.g. `plane`, `music`); the app maps them.

## Mobile app changes

| Route | Before | After |
|---|---|---|
| Interests catalogue | `GET /interests` → `[{id, name, slug}]` | Removed (404). Use `GET /catalog/interests` → `[{category, interests: [{id, name, slug, category, icon}]}]`, categories and items in display order |
| Prompts | — | `GET /catalog/prompts` → `[{id, text, category}]` |
| App config | — | `GET /app/config` (no token) → `{minVersion: {android, ios}, maintenance, featureFlags: {voiceVideoCalls, contactExchange, idVerification}, supportLinks: {helpCenterUrl, privacyPolicyUrl, termsUrl, supportEmail}}`. Call at start-up: show the update screen when the app version is below `minVersion`, a maintenance screen when `maintenance` is true; hide links that are null |
| Profile interests | `GET/PUT /profile/interests` | Unchanged; `maxInterests` now comes from the setting (10). Interests in the response also carry `category` and `icon` |
| Preferences | Distance 1–500 km | 1–200 km (400 `VALIDATION_ERROR` above) |

## Data changed by the migrations and seeders

| Database | `interests` aligned (`20261009000001`) | Seeders |
|---|---|---|
| dev `kuchu_puchu` | 15 rows will get the default category / icon / order (migrations not yet applied: `npm run migrate && npm run seed`) | Will insert 10 interests and update 15, insert 20 prompts and 10 settings |
| test `kuchu_puchu_test` | 15 rows | Inserted 10 interests, updated 15; inserted 20 prompts and 10 settings. Re-runs: 0 inserted, 0 updated |

## Deferred

| Item | Owner |
|---|---|
| `PUT /admin/settings/:key` and the admin UI | **M15** |
| Admin catalogue changes (add / retire interests and prompts) | **M15** |
| Settings for later modules (`likes.daily.free`, photo minimum, thresholds, windows) | Each module adds its keys to `SETTINGS` and the seeder picks them up |
| Profile prompt answers | **M09** |
