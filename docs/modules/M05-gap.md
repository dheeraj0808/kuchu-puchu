# M05 Security Audit: gap checklist

| | |
|---|---|
| Date | 2026-10-01 |
| Spec | Guide §8 M05, Appendix A/C where M05 touches them, Appendix B (security-events retention) |
| Scope | M05, plus audit events for what M04 added |
| Key | **done** · **partial** · **missing** (before) → [x] after |

Paths are relative to `backend/`.

## Before → after

| # | Spec item | Before | After | Where / how verified |
|---|---|---|---|---|
| 1 | `id BIGINT UNSIGNED AI` | **partial**: CHAR(36) UUID v7 | [x] | Migration `20261005000001-security-events-bigint-actor` rebuilds the table: rows copied in `created_at` order with new ids, the count is checked before the drop. Integration test "the table matches the spec" |
| 2 | `actor_user_id CHAR(36) NULL` | **missing** (M04 put the actor in metadata) | [x] | Column + model; `record({ actorUserId })` |
| 3 | `user_agent VARCHAR(255)` | **partial**: 512 | [x] | Longer values are cut to 255 (there were 0 in dev and test); `record()` cuts too |
| 4 | `ip_address VARCHAR(45)`, `event_type VARCHAR(64)`, `metadata JSON`, `created_at`, no `updated_at` | **done** | [x] | Unchanged |
| 5 | Indexes `(user_id, created_at)`, `(event_type, created_at)` | **done** | [x] | Kept, plus `(created_at)` for retention |
| 6 | `record()` never throws into the caller | **done** (`security-events.service.ts` try/catch) | [x] | Now logs the error class only. With a tx it writes in the caller's transaction; without, on its own. Tests below |
| 7 | Metadata never holds raw PII; identifiers only as a 12-char HMAC prefix | **partial**: no guard; account deletion stored full 64-char HMACs (`account.service.ts:43-46`) | [x] | `stripPii` drops `phone, email, identifier, otp, token, password, lat, lng` (any case, nested, arrays) with a warning that lists key paths only. `hashIdentifier()` gives a 12-char prefix; auth and account deletion now use it (`identifierHashPrefix` / `identifierHashPrefixes`) |
| 8 | Every auth / M04 action records an event | **partial**: auth yes; the M04 actions are new | [x] | Status changes (`user.status_changed`, with actor), `auth.account_restricted` (at most once per session per 5 min), `auth.session_revoked` (reason restricted) |
| 9 | Retention: 365 days; admin.* 3 years | **missing** | [x] | `security.retention` job on the M03 scheduler, `45 21 * * *` UTC (03:15 IST), batches of 5,000. `SECURITY_EVENTS_RETENTION_DAYS` / `_ADMIN_RETENTION_DAYS` / `_RETENTION_CRON` |

### `record()` calls checked

All 20 call sites (`auth.service.ts`, `session.service.ts`, `account.service.ts`, `profiles.service.ts`, `users.service.ts`, `revoke-sessions.handler.ts`, `jwt.strategy.ts`) were checked. The only raw identifier was the full HMAC in account deletion, now a 12-char prefix. No call passes an email, phone, OTP or token.

## Infra vars not in Appendix D

`SECURITY_EVENTS_RETENTION_DAYS` (365), `SECURITY_EVENTS_ADMIN_RETENTION_DAYS` (1095), `SECURITY_EVENTS_RETENTION_CRON` (`45 21 * * *`).

## Deferred

| Item | Owner |
|---|---|
| Admin API to view events | **M15** |
| `admin.*` events (moderation and admin actions) | **M15** (retention for them is already in place) |

## Data changed by the migration

| Database | security_events before | after |
|---|---|---|
| dev | 0 rows (UUID ids) | 0 rows (BIGINT ids) |
| test | rebuilt the same way; all rows copied, count checked | — |

## "Done when"

| # | Criterion | Status | How verified |
|---|---|---|---|
| D1 | Every auth, moderation and admin action records an event | [x] (auth and M04; moderation/admin actions arrive with M15) | Integration test "every auth and M04 action creates its event" goes through the real API. It covers request-otp, verify (register + login), a failed verify, refresh, logout, logout-all, then `setStatus` with an actor (`actor_user_id` column), a restricted request (403) and the restriction revoke handler. It asserts each event type, and that pre-user events carry only the 12-char prefix. |
| D2 | A failing insert never breaks the calling request | [x] | Integration test "a failing insert (DB down) never breaks the calling request": `SecurityEvent.create` rejects with `ConnectionError`, and `POST /auth/request-otp` still returns 200. Unit test: `record()` resolves and logs only the error class (the message held an email). |
| — | Nested PII never reaches the table | [x] | Integration test "nested PII keys never reach the table" (mixed-case keys, nested objects and arrays); unit `stripPii` |
| — | Retention deletes only the right rows | [x] | Integration test "retention deletes only non-admin events older than 365 days and admin.* older than 3 years": 11 seeded rows, batch size 2; `adminx.other` is treated as non-admin |

## Review

One combined spec and security review found 3 minor issues and 4 nits, and no blockers. Fixed:

- **`record()` inside a caller's transaction:** an insert error that already rolled that transaction back (deadlock, lost connection) is rethrown, so account deletion or `setStatus` can't report success for undone work. All other failures are still swallowed. This is a **deliberate narrowing of "never throws"**, only for the transaction-aborting case. Unit test: "rethrows errors that already rolled it back".
- **Migration:** the rebuild swaps tables with one atomic `RENAME`, copies rows written in between by legacy id, drops the old table only when nothing is missing, and can resume after a crash. Integration test: "the migration rebuilds a legacy (UUID id) table…" with 3 rows: order, user_agent cut to 255, FK restored, no helper column left.
- **PII guard:** it also drops key variants (`accessToken`, `refresh_token`, `phoneNumber`, `newEmail`, `otpCode`, `latitude`/`longitude`…), while `identifierHashPrefix(es)` and `identifierType` are allowed. This is **stricter than the owner's list**. Values under allowed keys are not inspected; callers pass codes and ids only.
- **Nits:** `input?.eventType` in the catch block; admin retention must be ≥ normal retention (env validation).

Left as is:
- The retention DELETE for non-admin events re-scans `admin.*` rows between 1 and 3 years old on each batch. It's cheap until M15 adds `admin.*` events.
- `down()` leaves `user_agent` at 255 (the migration is forward-only).

Also fixed during M05: the M03 relay failed fast on a connection that was still `connecting`, which made a test flaky. Now only `reconnecting`, `close` and `end` fail fast.

Final run: unit 484/484, integration 57/57, e2e 24/24; build, lint and type-check clean.
