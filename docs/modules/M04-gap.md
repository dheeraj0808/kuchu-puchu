# M04 Users: gap checklist

| | |
|---|---|
| Date | 2026-10-01 |
| Spec | Guide §8 M04, Appendix A (`user.status_changed`), Appendix C (`VALIDATION_ERROR`, `ACCOUNT_RESTRICTED`) |
| Scope | M04 plus the minimum wiring the owner listed: JwtAuthGuard restriction and session cache, the OTP-verify path, and the account-deletion status. |
| Key | **done** · **partial** · **missing** (before) → [x] after |

Paths are relative to `backend/`.

## Before → after

| # | Spec item | Before | After | Where / how verified |
|---|---|---|---|---|
| 1 | `status ENUM(active, suspended, banned, deactivated)` | **partial**: the enum had no `banned`; `is_banned` and `is_active` booleans were used alongside it | [x] | Migration `20261004000001-users-status-and-activity`. Test: "migration: is_banned / deleted rows end with the right status" |
| 2 | `is_banned` removed | **missing** | [x] | Same migration: data mapped, then the column dropped |
| 3 | `email_verified_at`, `phone_verified_at`, `role`, `last_login_at`, `deleted_at` | **done** | [x] | Unchanged; checked by the schema test |
| 4 | `suspended_until`, `discovery_restricted_at`, `last_active_at` | **missing** | [x] | Migration; model |
| 5 | `phone VARCHAR(16)` | **partial**: VARCHAR(20) | [x] | Migration shrinks it only if every stored value fits; otherwise it refuses |
| 6 | Indexes: email unique, phone unique, (status), (last_active_at) | **partial**: no `(last_active_at)` | [x] | Migration adds `users_last_active_at_idx` |
| 7 | Email lower-cased and trimmed; phone E.164 | **partial**: phone only stripped of spaces and dashes (`src/auth/utils/identifier.util.ts:9`); local forms like `98123 45678` were rejected or stored differently | [x] | `libphonenumber-js`, default region IN, in `identifier.util.ts`; used by the DTO transform and by `UsersService` before every lookup and insert. Invalid → 400 `VALIDATION_ERROR` |
| 8 | `createVerified` handles the unique-key race by re-reading | **partial**: the race was handled in `auth.service.ts:126-134` with a non-locking re-read, which at REPEATABLE READ can miss the winner's row | [x] | `UsersService.createVerified` re-reads with a locking read. Test: "10 parallel verifies for one new phone → exactly one user" |
| 9 | `canAuthenticate()` = status active and not deleted | **partial**: also checked `isActive` and `isBanned` | [x] | `user.model.ts` |
| 10 | Restricted user → 403 `ACCOUNT_RESTRICTED` | **partial**: the JWT strategy returned 401 | [x] | `jwt.strategy.ts`, `jwt-auth.guard.ts`. Integration test |
| 11 | Session state cached (`kp:session:<sid>`, 5 min), role from cache/DB | **missing**: every request read MySQL | [x] | `src/auth/session-state/*`. Invalidated after commit on logout, logout-all, revoke and status change |
| 12 | `setStatus(userId, status, reason, until?, actor?)`: user update + outbox `user.status_changed` + security event in one transaction | **missing** | [x] | `UsersService.setStatus` |
| 13 | Revoke sessions on restriction (through an event) | **missing** | [x] | Handler `users.revoke_sessions` (worker), idempotent |
| 14 | `touchLastActive`, global, throttled 5 min in Redis | **missing** | [x] | `src/users/last-active.interceptor.ts` (`SET kp:active:<id> NX EX 300`) |
| 15 | `last_login_at` on OTP verify | **done** (`auth.service.ts:145`, `users.service.ts:37`) | [x] | Unchanged |
| 16 | Account deletion sets `deactivated` | **partial**: it also read `isBanned` | [x] | `account.service.ts` reads `status === banned` |

## Deferred

| Item | Owner |
|---|---|
| Disconnect sockets on `user.status_changed` | **M19** |
| Close matches on ban | **M16** |
| Suspension lift job (`suspended_until` passed) | **M15** |
| Callers of `setStatus` (moderation API) | **M15** |
| Full account-deletion rework | **M07** |
| `users.is_active`: not in the spec and no longer read by `canAuthenticate`. Kept, because dropping it deletes data beyond the decisions. | Owner decision (drop in a later migration?) |

## Deviations and review fixes

- `setStatus(userId, status, reason, { until, actorUserId })`: an options object instead of positional `until?, actor?`. Setting the same status again is a no-op (no event, no audit row).
- `createVerified` returns `{ user, created }` so the caller knows whether this request registered the user.
- The verifyOtp transaction is retried (up to 3 attempts) on a MySQL deadlock. Waiters on the same unique key can deadlock during a registration race.
- Session cache: every invalidation also bumps `kp:session-ver:<sid>`. A request that loaded the old state before the change can therefore never write it back (atomic check-and-set in Lua). Invalidations inside a transaction run after the commit, and the caller waits for them.
- Sessions replaced by a new login on the same device are also dropped from the cache (review finding, fixed).
- The migration refuses to run if any stored phone is not valid E.164 per libphonenumber, because such a user could no longer sign in. There were 0 such rows.
- Migration data rule "else → active": rows that are already `suspended` (and not banned or deleted) keep `suspended`. Writing `active` would silently lift a suspension, which contradicts decision 4. Both databases had 0 users, so nothing was affected either way.

## "Done when"

| # | Criterion | Status | How verified |
|---|---|---|---|
| D1 | Identifiers normalised before every lookup | [x] | `UsersService.findByIdentifier` and `createVerified` call `normalizeIdentifierStrict` themselves, and the DTO transform normalises before OTP hashing. Integration test "normalisation: mixed-case email and spaced / local / +91 phone forms all map to the same user" covers 4 phone forms, a mixed-case email and a re-insert returning the same user. Unit tests: 7 phone forms → `+919812345678`, invalid → 400 `VALIDATION_ERROR` (also through the API). |
| D2 | Concurrent registration with the same phone creates exactly one user | [x] | Integration test "10 parallel OTP verifies for one new phone create exactly one user (real verifyOtp)": 10 concurrent `AuthService.verifyOtp` calls (mixed `+91` / local forms) all succeed with one user id and 1 row. The spy shows exactly 1 successful insert and ≥ 1 insert rejected by the unique key. It passed on 8 consecutive runs. |

## Migration status counts

| Database | Before | After |
|---|---|---|
| dev `kuchu_puchu` | 0 users | 0 users |
| test (seeded down → up) | active 12, suspended 2, deactivated 2 (incl. 2 `is_banned=1` and 2 deleted seed rows) | active 9, suspended 2, banned 4, deactivated 1 |

## Review

One combined spec + security review found 1 major, 5 minor and 4 nits. Fixed: the major (replaced-device sessions left in the cache), every minor (awaited afterCommit invalidation, stale re-cache, deadlock retry, stronger concurrency test, interceptor unit test) and three nits (no-op `setStatus`, `me()` → 403, migration phone check). Left as is: soft-deleted legacy rows that still hold a phone would make `createVerified` rethrow; there are 0 users today.
