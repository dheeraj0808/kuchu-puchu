# M07 Account: gap checklist

| | |
|---|---|
| Date | 2026-10-01 |
| Spec | Guide §3.5 (deletion registry), §8 M07, M15 `ban_hashes`, Appendix A (`account.deleted`), Appendix B (data export builder), Appendix C, Appendix D (AWS) |
| Scope | M07 as specified, plus the owner's decisions: deletion and export registries, ban hashes and the ban-evasion check on the canonical identifier, the confirmation email without PII in the outbox, the export flow, `StorageProvider` |
| Key | **done** · **partial** · **missing** (before) → [x] after |

Paths are relative to `backend/`. "Before" is the code at `e7c93c2` plus fix(M06).

## Tables

| # | Spec item | Before | After | Where / how verified |
|---|---|---|---|---|
| T1 | `data_export_requests`: `user_id` FK, `status ENUM(pending, processing, ready, expired, failed)`, `file_key VARCHAR(200) NULL`, `expires_at`, `completed_at` NULL; index `(user_id, created_at)` | **missing** | [x] | Migration `20261008000002`; `account.int-spec.ts` "data_export_requests is exactly the spec" |
| T2 | `ban_hashes` (M15): `hash_type ENUM(identifier, photo, device)`, `hash CHAR(64)`, `source_user_id CHAR(36) NULL`, unique `(hash_type, hash)` | **missing** | [x] | Migration `20261008000003`; "ban_hashes is exactly the M15 spec" |
| T3 | Identifiers always nulled on deletion; a one-off fix for rows soft-deleted before that rule | **partial** (new deletions nulled them; legacy rows kept them, see M04 Deferred) | [x] | Migration `20261008000001` (prints the count); "migration: email and phone are nulled on rows soft-deleted before M07" |

## Endpoints (under `/api/v1`)

| # | Endpoint | Before | After | Where / how verified |
|---|---|---|---|---|
| E1 | `DELETE /account` (step-up). Response warns that Play / App Store subscriptions must be cancelled in the store | **partial**: deleted, plain message | [x] | `{ message, storeSubscriptionNotice }`; "DELETE /account: every module hook runs…" |
| E2 | `POST /account/export` (step-up, 1 per 24 h, 202) | **missing** | [x] | 403 `REAUTH_REQUIRED` without step-up, 429 `TOO_MANY_REQUESTS` + `retryAfterSeconds` within 24 h; "limits: …" |
| E3 | `GET /account/export`: latest status and a signed URL when ready | **missing** | [x] | Presigned URL valid 15 min, new on every call; expired → no URL; "builds a ZIP…", "an expired link → no URL…" |

## Deletion

| # | Rule | After | Where / how verified |
|---|---|---|---|
| D1 | `AccountDeletionHandler { name, order, handle(userId, tx) }`; modules register through a registry; `AccountService` imports no module; duplicate names rejected at startup | [x] | `src/account/registry/account-registry.ts` (global `AccountRegistryModule`); unit "deletion handlers run by order (then name); duplicates and bad names fail at boot" |
| D2 | `AccountService.delete(userId)`: one transaction, `SELECT … FOR UPDATE` on the user, handlers in order; any failure rolls back everything | [x] | `account.service.ts`; unit + integration "one failing handler rolls back the whole deletion (nothing changed)" (interests and preferences deleted before the failing profile handler come back) |
| D3 | File purges after commit through outbox events only | [x] | `data_export.purge` published in the transaction; the worker deletes the files; "deleting the account deletes the export rows and purges their files after the commit" |
| D4 | Handlers now: auth (10) revoke all sessions, cache keys dropped after commit, and every session row scrubbed (IP, user agent, device name, token hashes) · interests (20) and preferences (25) deleted · profile (30) scrubbed and soft-deleted · data exports (40) rows deleted, files purged after commit · bans (900) · auth.devices (950) device ids replaced, after bans read them · users (1000) last: email and phone NULL, status deactivated, soft-deleted | [x] | `src/{auth,interests,preferences,profiles,users,bans}/account-hooks.ts` / `bans.module.ts`, `account/data-export.service.ts`; "DELETE /account: every module hook runs…" (order and counts in the audit event) |
| D5 | Banned user deleted → identifier hashes (canonical form, HMAC) and device hashes (their sessions' device ids) into `ban_hashes` | [x] | `BansDeletionHandler`, `BanHashesService`; "a banned user deletes; signing up again…"; "deleting a user who is not banned adds no ban hashes" |
| D6 | Ban evasion: a NEW user whose canonical identifier hash is in `ban_hashes` → like a banned user (403 `ACCOUNT_RESTRICTED` on a correct code; the same 200 on request) | [x] | `AuthService.verifyOtp` (inside the login transaction, before `createVerified`); unit "a NEW account for an identifier in ban_hashes…"; integration: `+tag`, dotted `googlemail.com`, upper-case and the same phone are all refused, no user row is created, the request body equals an unrelated address's |
| D7 | Confirmation email without PII in the outbox: email kept in `kp:deletion-mail:<userId>` (24 h) before the scrub; `account.deleted` carries the user id only; its handler sends the mail and deletes the key; no email → nothing sent | [x] | `AccountService`, `AccountDeletedMailHandler` (`GETDEL`, put back on a failed send except after the last attempt). The value is AES-256-GCM sealed (key derived from `OTP_HASH_SECRET`, purpose `deletion-mail`), never plain text (review). Tests: "the deletion email is sent once …", "a failed send puts the address back for the retry", "after the last failed attempt the sealed address is gone for good", "no email on the account → nothing is sent"; the key is removed when the transaction rolls back |
| D8 | Audit: `account.deleted` with 12-char identifier prefixes only | [x] | Metadata `{ wasBanned, identifierHashPrefixes, handlers, results }` (counts only); unit + integration assert no email/phone in it. Written `strict`: if the audit insert fails the deletion rolls back (review) |
| D9 | "Same phone can register again and gets a new user id" (Done when) | [x] | "the same phone registers again afterwards and gets a new user id" |

## Export

| # | Rule | After | Where / how verified |
|---|---|---|---|
| X1 | `AccountExportContributor { name, collect(userId) }` registry, same pattern | [x] | `AccountExportRegistry`; unit "export contributors are listed by name; duplicates fail at boot" |
| X2 | Contributors: account (status, dates, own identifiers), profile, interests, preferences, own sessions (device, platform, dates; no IPs), own security events (type and date only; user-facing types only, never moderation, restriction, OTP or fraud-guard events, never events with an actor) | [x] | `account.json`, `profile.json`, `interests.json`, `preferences.json`, `sessions.json`, `security_events.json` + `manifest.json`; "builds a ZIP with the caller's data only…" checks each file's keys |
| X3 | Export contains own data only (Done when) | [x] | Two seeded users with profiles, interests and preferences; B's id and email appear nowhere in A's ZIP; no IPs, no refresh secret |
| X4 | `POST`: `RequireReauth`; one per 24 h (429 + `retryAfterSeconds`); 202; enqueue a job | [x] | User row locked, so parallel requests cannot both pass; row + `data_export.requested` + a strict audit event in one transaction; failed builds do not count, up to 3 a day ("failed builds do not use up the daily export, but at most 3 a day") |
| X4b | Every presigned URL handed out is audited (`account.data_export_url_issued`, requestId only) | [x] | Review; "builds a ZIP…" counts 2 events for 2 calls |
| X5 | Worker builds a ZIP of JSON files, uploads to `S3_BUCKET_PRIVATE` at `exports/<requestId>.zip`, status ready, `expires_at = now + 24 h`, emails "your export is ready, open the app" (no URL) | [x] | `DataExportBuildHandler`; the email text is checked for no URL/key; the last failed attempt marks the request `failed` and deletes any uploaded file; a request deleted mid-build leaves no file ("the last failed build attempt…") |
| X6 | `GET`: latest status; ready and not expired → presigned URL valid 15 min, regenerated on every call | [x] | Two calls give two URLs; `downloadUrlExpiresAt` ≈ now + 15 min |
| X7 | Hourly job: ready exports past `expires_at` → expired, files deleted | [x] | `DataExportExpiryJob` (`17 * * * *`); "an expired link → no URL; the hourly job marks it expired and deletes the file" |
| X8 | `StorageProvider` in `src/infra`: S3 + a local-filesystem fake (no Docker) | [x] | `src/infra/storage/*`; `storage.spec.ts` (S3 commands with SSE, presigned URL TTL, path escapes refused) |

## Decisions and deviations

- **Two outbox events beyond Appendix A:** `data_export.requested` (`{requestId, userId}`) and `data_export.purge` (`{userId, requestIds}`). Appendix B lists the export builder as a queue job; going through the outbox means a request is never lost between the commit and the enqueue. The event-type test now says "Appendix A plus the two M07 export events".
- **Banned users cannot delete themselves through the API.** A banned account cannot sign in, so its deletion runs through `AccountService.delete(userId)` (M15 admin action later). The tests call the service.
- **`ban_hashes` is created in M07**, because deleting a banned account must keep its hashes; M15 adds the ban action and photo hashes. `source_user_id` has no foreign key (the spec gives none). Hashes are HMAC-SHA256 with `OTP_HASH_SECRET` and a domain prefix (`ban:identifier:` / `ban:device:`), so they never equal an OTP or audit hash. Rotating that secret empties the ban list in effect.
- **Device hashes are stored, not checked yet.** The owner's rule checks identifiers at sign-up. `X-Device-Id` / `deviceId` is client-chosen and phones are shared within families, so a device check needs the M15 review flow (flag, not block); left for M15 (security review M3).
- **`GET /account/export` has no step-up**, as specified (only `POST` needs one). Every URL it hands out is audited, valid 15 minutes, and made only for the caller's own latest export.
- **Session rows of a deleted account are kept, scrubbed:** the dates and platform remain for the 30-day session cleanup; IP, user agent, device id and name are blanked and the token hashes randomised. `security_events` keeps its IPs for the M05 retention (365 days), for abuse investigations.
- **The expiry job catches failures per row** and stops a batch in which nothing could be expired, so one bad file never blocks the rest.
- **`S3_BUCKET_PRIVATE` without `AWS_REGION` fails at startup** (it would otherwise fall back to local files silently).
- **Bucket settings live in infrastructure:** Block Public Access, default encryption and a TLS-only policy on `S3_BUCKET_PRIVATE`, plus a lifecycle rule expiring `exports/` after 2 days as a backstop. The code writes SSE-S3 on every put. See the Deployment guide.
- **`GETDEL` needs Redis 6.2+** (docker-compose runs Redis 7). The address is sealed with the user id as associated data, so a value never opens under another user's key. The 24 h TTL is far above the outbox retry window (8 attempts, exponential backoff from 1 s: minutes).
- **`users` runs last, enforced:** the registry refuses any other handler at order ≥ 1000 and any other order for `users`.
- **The URL audit is best effort** (`account.data_export_url_issued` is not strict): the guide asks for the event, and a failed insert should not block a download. The deletion and the export request audits are strict.
- **A failed last build attempt deletes the file only when it marked the request failed**, so a ready export's file is never removed by a late failure.
- **Export identifiers:** `account.json` holds the user's own email and phone in full (it is their data); no other person's identifier appears anywhere in an export.
- **GET /account/export with no request returns `data: null`** (200).
- **Redis down during deletion:** the deletion still happens, without the confirmation email (logged by error class).
- **No index for the expiry job** (`status, expires_at`): the spec lists `(user_id, created_at)` only and the table is small. The job runs hourly in batches of 500.
- **`STORAGE_LOCAL_DIR`** (development / test only) is not in Appendix D. Production requires `AWS_REGION` and `S3_BUCKET_PRIVATE`.
- **ZIP without a new package:** `src/common/utils/zip.ts` writes deflate archives with Node's `zlib` (CRC included); the test checks them with the system `unzip` when present.
- **New packages:** `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (guide §3.2 lists S3; `S3_BUCKET_PRIVATE` is in Appendix D). `npm audit` shows the same 9 pre-existing findings before and after.

## Review

Two reviewers ran in parallel.

**Spec audit, round 1:** no major gaps; every table, API, rule and Done-when item covered by a test. Minor, fixed: the expiry job stopped at one failing file; a throw after "ready" lost the ready email; the controller field `exports`; Redis version for `GETDEL` noted. Recorded: the ZIP is built in memory (fine at this size; revisit with photos).

**Spec audit, round 2:** every fix holds; no major. Fixed: a late failure on the last attempt could delete a ready export's file; `users`-last is now enforced by the registry; the URL audit's best effort and the retry window are noted; a sealed address that cannot be opened is logged.

**Security review, round 1:** no critical. Fixed: the deletion address in Redis is now AES-GCM sealed and dropped after the last attempt (H1); session rows of a deleted account are scrubbed (H2); download URLs are audited (M4); the security-events export is an allow-list (M5); the deletion and export-request audit rows are mandatory (M6); orphaned export files on failure or deletion mid-build (M7); failed builds capped at 3 a day, a partial S3 config fails at startup (L). Recorded: device-hash check (M3, M15), no step-up on GET (as specified), bucket settings in infrastructure.

**Security review, round 2:** no critical or high; every fix verified. Fixed: the sealed address is bound to the user id (AAD); `strict` without a transaction now throws. Accepted: the best-effort URL audit; no confirmation email when Redis is down at deletion; `UUID()` in the session scrub needs row-based binlogs (MySQL 8 default).

## Mobile app changes

| Route | Before | After |
|---|---|---|
| Delete account | `DELETE /account` → `{message}` | → `{message, storeSubscriptionNotice}`. Show `storeSubscriptionNotice` (cancel Google Play / App Store subscriptions in the store). Still needs a step-up within 10 min (403 `REAUTH_REQUIRED`) |
| Start export | — | `POST /account/export` (step-up required) → 202 `{requestId, status: 'pending'}`. 429 `TOO_MANY_REQUESTS` with `details.retryAfterSeconds` within 24 h of the last one; 403 `REAUTH_REQUIRED` |
| Export status | — | `GET /account/export` → `null` or `{requestId, status: 'pending'\|'processing'\|'ready'\|'expired'\|'failed', createdAt, completedAt, expiresAt, downloadUrl, downloadUrlExpiresAt}`. `downloadUrl` is set only while ready, valid 15 min: fetch it right before downloading, never store it. The ready email has no link, so the app must offer the download screen |

## Data changed by the migrations

| Database | `users` identifiers nulled (`20261008000001`) | New tables |
|---|---|---|
| dev `kuchu_puchu` | 0 (0 users; read-only count, migrations not yet applied: `npm run migrate`) | `data_export_requests`, `ban_hashes` |
| test `kuchu_puchu_test` | 23 (rows soft-deleted by earlier test runs) | same |

## Deferred

| Item | Owner |
|---|---|
| Deletion handlers for photos / verification (M11, M12), interactions / matches / chat (M16–M19), blocks / reports (M13, M14), notifications and push devices (M20), billing / contacts / calls (M21–M24), and socket disconnect | Each module, when built |
| Export contributors for the same modules | Each module, when built |
| Device-hash check at sign-in, photo hashes, the ban action itself | **M15** |
| Admin-triggered deletion of a banned account | **M15** |
| The four accepted items from fix(M06) | M06-gap.md "Before real SMS goes live" |
