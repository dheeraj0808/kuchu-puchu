# M06 Auth: gap checklist

| | |
|---|---|
| Date | 2026-10-01 |
| Spec | Guide §8 M06; Appendix A (`user.registered`, `auth.new_device`, `auth.token_reuse`), Appendix B (OTP cleanup, session cleanup), Appendix C (auth codes), Appendix D (Auth, SMS / Email) |
| Scope | M06 as specified, plus the owner's decisions (tables, the 10 endpoints, OTP rules, SMS fraud guard, providers, tokens and sessions, step-up, onboarding, jobs, security events). |
| Key | **done** · **partial** · **missing** (before) → [x] after |

Paths are relative to `backend/`. "Before" is the code at `93b3ff8`.

## Tables

| # | Spec item | Before | After | Where / how verified |
|---|---|---|---|---|
| T1 | `otp_verifications.identifier_hash CHAR(64)` = HMAC-SHA256(OTP_HASH_SECRET, "type:normalised") | **done** (`otp.service.ts` `hashIdentifier`) | [x] | `otp.service.ts` `hashIdentifier`; unit "hashes the identifier as HMAC-SHA256…" |
| T2 | `channel ENUM(sms, email)` | **partial**: `identifier_type ENUM(email, phone)` | [x] | Migration `20261007000001-rebuild-otp-verifications`; `test/integration/auth.int-spec.ts` "otp_verifications is exactly the spec" |
| T3 | `purpose ENUM(login, reauth)` | **missing** | [x] | Same migration and test |
| T4 | `otp_hash`, `attempts`, `expires_at`, `consumed_at`, `request_ip VARCHAR(45)` | **partial**: present; `request_ip` nullable; extra `user_id`, `max_attempts`, `updated_at` | [x] | Same; `user_id`, `max_attempts` dropped; `request_ip` NOT NULL |
| T5 | No `updated_at` | **missing** (has `updated_at`) | [x] | Same (model `updatedAt: false`) |
| T6 | Indexes `(identifier_hash, created_at)`, `(request_ip, created_at)` | **partial**: `(identifier_hash, identifier_type, created_at)` plus `expires_at`, `user_id` indexes | [x] | Same test asserts exactly the two index sets |
| T7 | `sessions.previous_token_hash` | **partial**: named `previous_refresh_token_hash` | [x] | Migration `20261007000002-rebuild-sessions`; `test/integration/auth.int-spec.ts` "sessions is exactly the spec" |
| T8 | `device_id VARCHAR(100)`, `device_name VARCHAR(100)` | **partial**: VARCHAR(128), nullable | [x] | Same (NOT NULL; verify requires them) |
| T9 | `platform ENUM(android, ios)`, `app_version VARCHAR(20)` | **missing** | [x] | Same |
| T10 | `user_agent VARCHAR(255)` | **partial**: VARCHAR(512) | [x] | Same (cut to 255 on write) |
| T11 | `expires_at` sliding (+30 d per refresh) | **partial**: fixed `JWT_REFRESH_EXPIRES_IN` (7 d) | [x] | `session.service.ts` `slidingExpiry`; `test/integration/auth.int-spec.ts` "sliding expiry extends…" |
| T12 | `absolute_expires_at` = created_at + 90 d, never extended | **missing** | [x] | Same test: never moves, caps the slide, past it → 401 |
| T13 | `reauthenticated_at` | **missing** | [x] | Column + `markReauthenticated`; step-up tests |
| T14 | `revoked_reason VARCHAR(40)`: logout, logout_all, replaced, reuse_detected, restricted, deleted | **partial**: VARCHAR(64); values `replaced_by_new_login`, `refresh_token_reuse`, `account_restricted`, `account_deleted` | [x] | `SessionRevokeReason` = the six spec values; tests assert `replaced`, `reuse_detected`, `deleted` |
| T15 | Indexes `(user_id, revoked_at)`, `(user_id, device_id)` | **partial**: both, plus `expires_at` and a unique `refresh_token_hash` | [x] | Same migration and test (extra indexes dropped) |
| T16 | FK `sessions.user_id` → users, ON DELETE RESTRICT (guide §4.2) | **partial**: CASCADE | [x] | Migration (`ON DELETE RESTRICT`) |

## Endpoints (under `/api/v1`)

| # | Endpoint | Before | After | Where / how verified |
|---|---|---|---|---|
| E1 | `POST /auth/otp/request` `{channel, identifier}`, always the same 200 | **partial**: `POST /auth/request-otp` `{identifierType, identifier}`; banned users get no code but the same 200 | [x] | `auth.controller.ts`; `test/integration/auth.int-spec.ts` "identical /otp/request responses…" |
| E2 | `POST /auth/otp/verify` `{channel, identifier, otp, deviceId, deviceName, platform, appVersion}` → `{accessToken, refreshToken, expiresIn, user, isNewUser, nextStep}` | **partial**: `POST /auth/verify-otp`; device fields optional, no platform/appVersion; response has `tokenType`, `accessTokenExpiresIn`, `refreshTokenExpiresAt`, no `isNewUser`/`nextStep` | [x] | `test/integration/auth.int-spec.ts` "verify creates the user and returns {…}" (exact key set) |
| E3 | `POST /auth/refresh` `{refreshToken}` → new pair | **partial**: rotates; reuse revokes only that session; error `INVALID_REFRESH_TOKEN` (not in Appendix C) | [x] | `test/integration/auth.int-spec.ts` refresh tests; response keys `accessToken, expiresIn, refreshToken` |
| E4 | `POST /auth/logout` `{refreshToken}`, always 200 | **done** | [x] | `test/integration/auth.int-spec.ts` "logout is always 200…" |
| E5 | `POST /auth/logout-all` | **done** | [x] | Same test (current session included) |
| E6 | `GET /auth/me` account summary + `nextStep` | **partial**: no `nextStep` | [x] | `test/integration/auth.int-spec.ts` "verify creates the user…" asserts `nextStep: selfie` on `/auth/me` |
| E7 | `GET /auth/sessions` | **missing** | [x] | `test/integration/auth.int-spec.ts` "GET /auth/sessions…" |
| E8 | `DELETE /auth/sessions/:sessionId` (404 if not the caller's) | **missing** | [x] | `test/integration/auth.int-spec.ts` "DELETE /auth/sessions/:id…" (other user's, unknown, malformed → 404) |
| E9 | `POST /auth/reauth/request` | **missing** | [x] | `test/integration/auth.int-spec.ts` step-up tests |
| E10 | `POST /auth/reauth/verify` `{otp}` | **missing** | [x] | Same |
| E11 | Old routes `/auth/request-otp`, `/auth/verify-otp` removed, no aliases | — | [x] | `test/app.e2e-spec.ts` "exactly the 10 auth endpoints are documented; the old routes are gone" (Swagger paths + 404) |

There is no separate `/me` route in the code; `GET /auth/me` is the spec's endpoint E6 and stays (with a new field).

## Rules

| # | Rule | Before | After | Where / how verified |
|---|---|---|---|---|
| R1 | 6 digits, CSPRNG | **done** (`crypto.util.ts` `randomInt`) | [x] | Unchanged (`randomInt`) |
| R2 | Valid 5 min, 5 attempts, atomic `attempts + 1 WHERE attempts < max` | **done** | [x] | `test/integration/auth.int-spec.ts` "6th attempt fails even with the right code" (attempts = 5 in the row) |
| R3 | Constant-time compare | **done** (`timingSafeEqualHex`) | [x] | `timingSafeEqualHex`; dummy compare on not-found |
| R4 | Consumed once by a conditional update | **done** | [x] | `test/integration/auth.int-spec.ts` "race: two parallel verifies of one code → exactly one success" |
| R5 | One active code per identifier (a new code expires older ones) | **partial**: expires older codes, but two parallel requests can both pass the cooldown check and leave two active codes | [x] | Redis `SET NX` cooldown serialises issuance; `test/integration/auth.int-spec.ts` "…a new code expires the older one" (1 active row) |
| R6 | 60 s cooldown → 429 `OTP_COOLDOWN` + `retryAfterSeconds` | **partial**: DB read, racy (see R5) | [x] | `test/integration/auth.int-spec.ts` "cooldown → 429 OTP_COOLDOWN with retryAfterSeconds" |
| R7 | 5 codes / hour per identifier; 20 / hour per IP (config) | **partial**: per-IP cap is a constant, not `OTP_MAX_PER_IP_PER_HOUR` | [x] | `OTP_MAX_PER_IP_PER_HOUR`; since fix(M06) both are Redis sliding windows per purpose (see below); `test/integration/auth.int-spec.ts` "hourly per-identifier cap…", "per-IP cap…" |
| R8 | HTTP throttle: request 5/min per IP, verify 10/min per IP | **done** | [x] | `test/integration/auth.int-spec.ts` "HTTP throttles…" |
| R9 | No enumeration: same 200 for unknown, known, banned, deleted; same 401 `OTP_INVALID` for every verify failure | **partial**: same body, but banned users skip the cooldown and caps, so a second request within 60 s answers 200 for them and 429 for others | [x] | No account lookup in request; `test/integration/auth.int-spec.ts` "identical /otp/request responses…" (first and second request) |
| R10 | Banned/suspended + correct code → 403 `ACCOUNT_RESTRICTED`, no tokens | **partial**: banned users never receive a code, so the rule can't be reached | [x] | `test/integration/auth.int-spec.ts` "banned or suspended user with the CORRECT code → 403…" |
| R11 | SMS country allowlist (`OTP_SMS_ALLOWED_COUNTRIES`, +91) | **missing** | [x] | `otp-delivery.service.ts`; `test/integration/auth.int-spec.ts` "a number outside OTP_SMS_ALLOWED_COUNTRIES…"; unit spec |
| R12 | Daily global SMS budget (`SMS_DAILY_BUDGET`, Redis per IST date), alert at 80 %, stop at 100 % (split into two pools in fix(M06), F1) | **missing** | [x] | `test/integration/auth.int-spec.ts` "daily SMS budget…"; unit spec (one alert each at 80 % and 100 %) |
| R13 | `SmsProvider` / `EmailProvider` in `src/infra`; SES + fake email; fake SMS; production refuses `SMS_PROVIDER` unset or `fake`; `OTP_DEV_ECHO` refused in production | **partial**: one `DevOtpDeliveryService` that throws in production; echo refused in production | [x] | `src/infra/sms`, `src/infra/email`; `sms.spec.ts`; env spec "production refuses SMS_PROVIDER unset or fake" |
| R14 | Access token HS256, 15 min, claims `{sub, sid, iss, aud}`; role from DB | **partial**: token also carries `role` (ignored by the strategy, read from the session cache) | [x] | `token.service.ts`; unit + `test/integration/auth.int-spec.ts` assert the claim set exactly |
| R15 | Refresh token `<sessionId>.<64-char secret>`, stored as HMAC, rotated on every use | **done** (secret regex accepts 43–128 chars) | [x] | Secret must be exactly 64 chars; HMAC only ("no plaintext OTP or token is stored") |
| R16 | Reuse of the previous token → revoke ALL sessions (`reuse_detected`), `auth.token_reuse`, security event, 401 `UNAUTHORIZED` | **partial**: revokes that one session; no event; `INVALID_REFRESH_TOKEN` | [x] | `test/integration/auth.int-spec.ts` "reuse of an old token → every session revoked…" |
| R17 | Concurrent refresh loser treated as reuse | **missing**: loser gets a plain 401 | [x] | `test/integration/auth.int-spec.ts` "race: two parallel refreshes of one token…" |
| R18 | Sliding 30 d / absolute 90 d | **missing** | [x] | See T11/T12 |
| R19 | Same deviceId replaces the live session (`replaced`); unseen deviceId → `auth.new_device` | **partial**: replaces; no event; two parallel logins on one device can leave two live sessions | [x] | User row lock in the login transaction; `test/integration/auth.int-spec.ts` "same deviceId login replaces that session…" |
| R20 | Logout always 200; logout-all revokes every session incl. current; every revoke deletes the Redis cache key before returning | **done** | [x] | Unchanged; logout / revoke tests check the next request is 401 |
| R21 | `GET /auth/sessions`: name, platform, app version, last used, `current`; other sessions' IPs masked | **missing** | [x] | `SessionResponse.fromModel`, `maskIp`; `test/integration/auth.int-spec.ts` "GET /auth/sessions…" |
| R22 | Step-up: reauth OTP to own verified identifier; `reauthenticated_at`; `RequireReauth` → 403 `REAUTH_REQUIRED` unless within 10 min; on `DELETE /account` | **missing** (`DELETE /account` has no step-up) | [x] | `RequireReauthGuard` on `DELETE /account`; `test/integration/auth.int-spec.ts` step-up tests (no reauth, wrong code, other session, > 10 min) |
| R23 | `OnboardingService.nextStep`: selfie → photos → profile → preferences → done, provider per step; selfie/photos stubs | **partial**: `OnboardingStatusService` stub returns `selfie` | [x] | `src/common/onboarding/*`; `onboarding.service.spec.ts` |
| R24 | `VerifiedUserGuard` uses it; 403 `ONBOARDING_INCOMPLETE` + `details.nextStep`; not applied to routes yet | **partial**: uses the old stub | [x] | `access.guards.ts`; `access.guards.spec.ts`; not applied to routes |
| R25 | `user.registered` published in the registration transaction (M03 F1) | **missing**: security event only | [x] | Published in the login transaction; `test/integration/auth.int-spec.ts` asserts the outbox row |
| R26 | OTP cleanup hourly (> 24 h); session cleanup daily 21:00 UTC (expired, or revoked > 30 d), batches of 5,000 | **missing** (deferred from M03) | [x] | `auth-cleanup.jobs.ts` (`7 * * * *`, `0 21 * * *`, batches of 5,000); `test/integration/auth.int-spec.ts` cleanup tests; `entrypoints.int-spec.ts` (worker registers both) |
| R27 | Security events: otp requested/verified/failed, login, new device, reuse, logout, logout-all, session revoked, reauth ok/failed, budget and country blocks; identifiers only via `hashIdentifier()` | **partial**: no new-device, reauth, budget or country events; `otp.verified` unused | [x] | New types in `security-event.model.ts`; asserted per flow in `auth.int-spec.ts` / `auth.service.spec.ts` |

## Plan (as built)

- Two migrations rebuild `otp_verifications` and `sessions` to the spec. Dev has 0 users, so existing rows are deleted and the tables recreated (counts printed by the migration).
- New error handling: refresh failures return Appendix C `UNAUTHORIZED`; `INVALID_REFRESH_TOKEN` is removed.
- Cooldown is an atomic Redis `SET NX EX 60` per identifier (serialises issuance, fixes R5/R6). Caps stayed as indexed DB counts (fix(M06) moved them to Redis windows).
- Every identifier goes through the same cooldown, caps and insert, so the response never depends on account state (R9). The code is sent to every allowed destination; a banned user who enters it gets 403 (R10).
- Providers live in `src/infra/sms` and `src/infra/email`; OTP text, dev echo, country guard and budget live in auth's `OtpDeliveryService`.
- Alerts move into the API process too (budget alerts), with new alert kinds.

## Mobile app changes

The mobile app (`mobile-app/src/api/auth.ts`, `types.ts`, `account.ts`) still calls the old contract. Nothing is aliased.

| Route | Before | After |
|---|---|---|
| Request code | `POST /auth/request-otp` `{identifierType: 'email'\|'phone', identifier}` | `POST /auth/otp/request` `{channel: 'email'\|'sms', identifier}`. Response unchanged: `{message, expiresInSeconds, resendAfterSeconds}`. 429 `OTP_COOLDOWN` / `TOO_MANY_REQUESTS` with `details.retryAfterSeconds` |
| Verify code | `POST /auth/verify-otp` `{identifierType, identifier, otp, deviceId?, deviceName?}` → `{accessToken, refreshToken, tokenType, accessTokenExpiresIn, refreshTokenExpiresAt, user}` | `POST /auth/otp/verify` `{channel, identifier, otp, deviceId, deviceName, platform: 'android'\|'ios', appVersion}` (all required) → `{accessToken, refreshToken, expiresIn, user, isNewUser, nextStep}`. `tokenType`, `accessTokenExpiresIn`, `refreshTokenExpiresAt` are gone (`expiresIn` = access-token seconds). Wrong/expired code: 401 `OTP_INVALID`; restricted account with a correct code: 403 `ACCOUNT_RESTRICTED` |
| Refresh | `POST /auth/refresh` → same shape as verify | `{refreshToken}` → `{accessToken, refreshToken, expiresIn}` (no `user`). Any failure, including reuse: 401 `UNAUTHORIZED` (was `INVALID_REFRESH_TOKEN`). A replayed or raced token signs the user out on every device, so the app must never send two refreshes with the same token |
| Logout | `POST /auth/logout` `{refreshToken}` | Unchanged; always 200 `{message}` |
| Logout everywhere | `POST /auth/logout-all` | Unchanged; revokes the current session too |
| Me | `GET /auth/me` → user + `profile` | Same fields plus `nextStep` (`selfie`\|`photos`\|`profile`\|`preferences`\|`done`). Today it is `selfie` for everyone (M11/M12 not built), so the app's "missing = done" fallback must go |
| Devices | (mocked: `{id, deviceName, city, lastActiveAt, isCurrent}`) | `GET /auth/sessions` → `[{id, deviceName, platform, appVersion, lastUsedAt, createdAt, ipAddress, current}]`; `ipAddress` of other sessions has the last octet masked; no `city` |
| Sign out one device | (mocked) | `DELETE /auth/sessions/:sessionId` → 200 `{message}`; 404 `NOT_FOUND` if it is not one of the caller's live sessions |
| Step-up request | (mocked: no body) | `POST /auth/reauth/request` `{channel?: 'sms'\|'email'}` → `{message, channel, expiresInSeconds, resendAfterSeconds}`; default phone if verified, else email |
| Step-up verify | (mocked: `{code}` → `{validForSeconds}`) | `POST /auth/reauth/verify` `{otp}` → `{reauthenticatedAt, validForSeconds: 600}`. A wrong code is 401 `OTP_INVALID`: the app must not treat that 401 as an expired session |
| Delete account | `DELETE /account` | Now needs a step-up within 10 min, else 403 `REAUTH_REQUIRED` |
| Device fields | — | `deviceId` must match `^[A-Za-z0-9._:-]{1,100}$` (use the same value as `X-Device-Id`), `deviceName` 1–100 chars, `appVersion` `^[0-9A-Za-z.+-]{1,20}$`, `platform` `android`\|`ios`. Anything else is 400 `VALIDATION_ERROR` |
| Types | `UserStatus` lacks `banned` | `banned` exists since M04 |
| Device header (fix(M06)) | — | Send `X-Device-Id` (the same value as `deviceId`) on `POST /auth/otp/request`. Requests without it share a per-IP bucket of 10 codes per hour and may get 429 `TOO_MANY_REQUESTS` behind carrier NAT |
| Session cap (fix(M06)) | — | Signing in on an 11th device signs out the least recently used one; it gets 401 `UNAUTHORIZED` on its next call or refresh |

## Deferred

| Item | Owner |
|---|---|
| Real SMS provider (DLT-registered sender and template). Until then production refuses to boot | Owner / ops (after DLT registration) |
| `auth.new_device` / `auth.token_reuse` handlers (security push + email) | **M20** |
| Appeal token for restricted users | **M15** |
| `user.registered` handlers (analytics, welcome) | **M20** |
| Data export step-up (`POST /account/export`) | **M07** |
| Null identifiers of soft-deleted rows (from fix(M04)) | **M07** |
| Selfie and photo onboarding providers | **M11**, **M12** |
| Applying `VerifiedUserGuard` to routes | M11+ |
| ~~Security review M2, M3, L1, L2, L4~~ | Decided by the owner and done in **fix(M06)**, below |
| fix(M06) review H1: once the new-identifier SMS pool is used up, a request for an unknown number returns without calling the provider, while one for an existing account waits for the SMS provider. The latency difference shows whether a number has an account. Options: send SMS off the request path (in-process after the response; the 503 `OTP_DELIVERY_FAILED` would then never reach the client), or pad blocked requests to the provider's typical latency | **Owner decision** |
| fix(M06) review M5: the email budget is one global pool, so 20,000 requests for random addresses stop email sign-in and email step-up for everyone until IST midnight. Option: the same new / existing split as SMS | **Owner decision** |
| fix(M06) review L9: an attacker with a list of registered numbers can use up the reserve, and existing accounts then fall back to the new pool. Option: no fallback, or a per-IP share of the reserve | **Owner decision** |
| fix(M06) review L7: Redis keys hold the raw IP bucket and `X-Device-Id` (as the M01 throttler's keys already hold IPs). Option: HMAC them | Owner decision (low) |

## Deviations and notes

- **`auth.new_device` is not published on the registration login.** A brand-new account has no other device to warn. Every later sign-in from an unseen `deviceId` publishes it. "Unseen" means no retained `sessions` row; rows are deleted 30 days after revocation or on expiry, so a device unused for longer counts as new again.
- **Reuse is detected one rotation back** (the spec stores only `previous_token_hash`). A token two or more rotations old gets a plain 401 without the revoke-all. Treating every mismatch as reuse would let anyone who knows a session id sign the user out everywhere.
- **Refresh failures return `UNAUTHORIZED`** (Appendix C). `INVALID_REFRESH_TOKEN` was removed.
- **`DELETE /auth/sessions/:id` returns `NOT_FOUND`**, a pre-existing code that is not in Appendix C (like `VALIDATION_ERROR` details for the step-up channel). A malformed id is the same 404.
- **`GET /auth/me` keeps `profile`** (the app reads it) and adds `nextStep`.
- **`user_agent` / `ip_address` are NOT NULL as in the spec**, stored as `''` when the request has none. Requests without an IP share one per-IP bucket; production requires `TRUST_PROXY`, so `req.ip` is always set.
- **Cooldown in Redis** (`kp:otp-cooldown:<purpose>:<canonical hash>` since fix(M06), `SET NX EX 60`). Caps are Redis sliding windows since fix(M06). A cap 429 or an unexpected error hands back the cooldown and every slot; a failed delivery hands back all but the IP slot.
- **Session cleanup has no index** on `expires_at` / `revoked_at` (the spec lists two index sets only). The job walks the primary key with plain reads and deletes by id, once a day.
- **Review hardening beyond the decisions:** production refuses `TRUST_PROXY=true` (a client-chosen `X-Forwarded-For` would bypass every per-IP limit); `OTP_DEV_ECHO` is refused outside development and test (staging included).
- **New package:** `@aws-sdk/client-sesv2`, for the SES email provider (guide §3.2 lists SES). `npm audit` shows the same 9 pre-existing findings before and after.

## Not in Appendix C

| Code | HTTP | Used by |
|---|---|---|
| `NOT_FOUND` | 404 | `DELETE /auth/sessions/:sessionId` when the id is not one of the caller's live sessions (also malformed ids); otherwise unknown paths (M01) |

## fix(M06): owner decisions on the security review

| # | Decision | Where / how verified |
|---|---|---|
| F1 (M2) | `SMS_DAILY_BUDGET` is split into a new-identifier pool (`SMS_BUDGET_NEW_IDENTIFIER_PERCENT`, default 70) and a reserve for identifiers that already belong to an account (the rest, 30). Keys `kp:sms-budget:<new\|existing>:<IST date>`. Each pool alerts once at 80 % and once when used up. Existing accounts (and every step-up) use the reserve first, then the new pool; new identifiers never touch the reserve | `otp-delivery.service.ts` `takeSmsBudget`; unit "an exhausted new-identifier pool never blocks existing accounts", "existing accounts fall back…"; `auth.int-spec.ts` "a used-up new-identifier pool never blocks an existing account…", "the reserve pool alerts at 80 %…" |
| F2 (M2) | Per-device cap on code requests: `OTP_MAX_PER_DEVICE_PER_HOUR` (10) per `X-Device-Id`; without the header, one shared `no-device` bucket per IP. Redis sliding window. The header is client-chosen, so the per-IP cap (20 / hour) is the real bound; the device cap slows ordinary clients behind one NAT | `otp.service.ts` `otpDeviceKey`; unit "per device…" (both); `auth.int-spec.ts` "per device: the 11th code…" |
| F3 (M3) | Canonical email (`canonicalEmail`): lower-case, `+tag` removed on every domain, dots removed for gmail.com / googlemail.com, googlemail → gmail. Used for the OTP cooldown and caps here; ban checks use it from M07 (`ban_hashes`). The stored email and the code lookup are unchanged | `identifier.util.ts`; `OtpService.rateLimitHash`; unit "canonicalEmail…", "rateLimitHash…"; `auth.int-spec.ts` "email aliases … share one cooldown; the stored email stays as entered", "email aliases share one hourly cap" |
| F4 (M3) | `EMAIL_DAILY_BUDGET` (20,000 per IST day): alert at 80 %, stop at 100 % with the same 200, an alert and `otp.email_budget_blocked` | Unit "email budget per IST date…"; `auth.int-spec.ts` "daily email budget…" |
| F5 (L1) | Step-up (`purpose=reauth`) has its own cooldown, hourly cap (`OTP_REAUTH_MAX_PER_HOUR`, 5), per-IP count and device bucket. A new code expires older codes of the same purpose only | Unit "step-up has its own cooldown and hourly cap…", "expires older active codes of the same identifier and purpose only"; `auth.int-spec.ts` "sign-in code spam for the account never blocks its step-up…" |
| F6 (L2) | `SESSION_MAX_PER_USER` (10) live sessions. A login beyond it revokes the least recently used (`replaced`), drops its cache key, and records `auth.session_revoked` with `cause: session_cap` (a same-device sign-in is `cause: same_device`) | `session.service.ts` `create`; unit "session cap…" (both); `auth.int-spec.ts` "an 11th live session revokes the least recently used one…" |
| F7 (L4) | `auth.refresh_token_invalid` for tokens that name no real session (malformed, unknown session id) is written at most once per IP per 5 minutes (`kp:refresh-invalid-audit:<ip bucket>`, `SET NX EX 300`, like M05's restricted-user events). Failures against a real session (with a `userId`: hash mismatch, revoked, expired) and reuse detection are never throttled | `SessionStateService.takeAuditSlot`; unit "invalid refreshes are audited at most once per IP…"; `auth.int-spec.ts` "invalid refreshes write at most one security event per IP…" |

Notes on the fix:

- **Codes are still looked up by the exact identifier.** Only the cooldown and caps use the canonical form. Redeeming a code sent to `victim+x@corp.com` as `victim@corp.com` would be an account takeover on domains where `+` is part of the mailbox name.
- **Every OTP cap is now an atomic Redis sliding window** (sorted set + one Lua script, Redis server clock): per canonical identifier (`kp:otp-hourly:<purpose>:<hash>`), per IP (`kp:otp-ip:<purpose>:<ip bucket>`) and per device. The per-identifier cap had to leave MySQL because `otp_verifications` stores only the exact hash; the per-IP count moved too, because check-then-insert in MySQL let parallel requests overshoot it (review). A cap that refuses, or a failed delivery, hands back the cooldown and every slot taken.
- **An IPv6 /64 counts as one IP** (`ipBucket`) for the per-IP cap, the no-device bucket and the refresh-audit throttle (review). IPv4 and IPv4-mapped addresses are used as they are.
- **Security events show the SMS pool only on a blocked send** (`budgetPool`); a sent code does not record it, so the log does not mark which identifiers have accounts.
- **A failed delivery keeps the IP slot** (round 2 review): the cooldown, identifier and device slots are handed back, so a provider outage does not use up a user's allowance, but the IP cap still bounds retries. An unexpected Redis / MySQL error during issuance hands back everything.
- **The account lookup runs after the caps pass**, so refused requests cost no extra query.
- **The sliding-window script calls `TIME` before writing**, which needs Redis 5 or later (docker-compose runs Redis 7).
- **`+tag` is removed on every domain**, as decided. On the few domains where `+` is part of the mailbox name, two different mailboxes then share one cooldown and cap (availability only; codes are still per exact address).
- **"One active code per identifier" is now per identifier and purpose** (the owner's decision for L1). A sign-in code no longer expires a pending step-up code.
- **`POST /auth/otp/request` now looks the account up**, only to pick the SMS pool. The lookup runs for every request and the response is identical (the no-enumeration test still passes).
- **New env variables** (Appendix D, Auth / SMS / Email): `SESSION_MAX_PER_USER`, `OTP_MAX_PER_DEVICE_PER_HOUR`, `OTP_REAUTH_MAX_PER_HOUR`, `SMS_BUDGET_NEW_IDENTIFIER_PERCENT`, `EMAIL_DAILY_BUDGET`; in `.env.example`.

### Review of fix(M06)

Two reviewers ran in parallel, for 2 rounds.

**Spec audit.** Round 1: no major; minor: ban checks don't use the canonical form yet (now stated as M07 work), single email pool / device-header rotation / reserve fallback (recorded), failed delivery kept the cap slots (fixed), the throttle hid user-linked events (fixed); nits: headerless bucket at its limit and config-derived budgets in the tests (fixed). Round 2: every fix holds; stale lines in this file (fixed).

**Security review.** Round 1: H1 timing difference once the new pool is used up (owner decision, below); M3 non-atomic per-IP cap (fixed: Redis window), M4 IPv6 rotation (fixed: /64 buckets), M6 throttle scope (fixed), L8 pool in the audit log (fixed), L10 clock skew (fixed: Redis `TIME`), L11 eviction cause (fixed); M2, M5, L7, L9 recorded. Round 2: no critical or high; fixed: slots leaked on an unexpected error, unlimited retries after failed deliveries (IP slot kept), hex-form IPv4-mapped addresses, lookup before the caps, Redis version note. Accepted: one shared `unknown` IP bucket (production always has `req.ip`), a plain `DEL` of the cooldown on release (needs a failure slower than 60 s), `budgetPool` on blocked events (log readers only), the unit fake re-implements the Lua script (the real script runs in the integration tests: hourly, IP, device and no-device caps).

## Data changed by the migrations

| Database | `otp_verifications` deleted | `sessions` deleted | Other |
|---|---|---|---|
| dev `kuchu_puchu` | 0 | 0 | `users.is_active` dropped (fix(M04)); 0 users |
| test `kuchu_puchu_test` | 69 | 545 | Rows left by earlier test runs |

## "Done when"

| # | Criterion | Status | How verified |
|---|---|---|---|
| D1 | No plaintext OTP or token anywhere in DB or logs | [x] | DB: `auth.int-spec.ts` "no plaintext OTP or token is stored" (dumps both tables, looks for the refresh secret, the access token and the email; `otp_hash` is 64-hex). Logs: `test/support/log-scan.ts` runs after every integration and e2e file and captures pino (debug level), Nest's Logger, console and stdout/stderr. It fails the file on any OTP or identifier handed to the fake providers, a JWT, a refresh token, an email or a phone number. Final run: 0 hits in 816 integration lines and 401 e2e lines; a self-check test proves it catches planted leaks and that request logs are in the capture |
| D2 | Race tests: two verifies of one code, two refreshes of one token | [x] | "race: two parallel verifies of one code → exactly one success" (200 + 401, one user row). "race: two parallel refreshes of one token → one success; the other is reuse…" (200 + 401, every session `reuse_detected`, the winner's new token and the other device both 401, one `auth.token_reuse` row) |
| D3 | Reuse detection revokes all sessions | [x] | "reuse of an old token → every session revoked, auth.token_reuse published, security event, 401 UNAUTHORIZED" |
| D4 | Banned user gets an identical OTP response | [x] | "identical /otp/request responses for unknown, known, banned and deleted identifiers (status and body), first and second request"; and "banned or suspended user with the CORRECT code → 403 ACCOUNT_RESTRICTED, no tokens, no session" |

## Review

Two reviewers ran in parallel, for 2 rounds.

**Spec audit.** Round 1: 1 major, 4 minor, 4 nits.
- Fixed:
  - Major: the integration tests could not be re-run within an hour (fixed test IPs and numbers against OTP rows the local test DB keeps). Test IPs and numbers are now random per run; 3 back-to-back full runs passed.
  - Minor: a cap 429 now hands the cooldown back.
  - Minor: the checklist is filled in.
  - Nit: the device-field formats are now in the mobile table.
  - Nit: the log scan also remembers national-format phone numbers.
- Recorded as notes: reuse is detected only one rotation back; `NOT_FOUND` is not in Appendix C; requests without an IP share one bucket; session cleanup has no index.
- Round 2: every fix holds. The only gap it raised (`0.0.0.0/0` as `TRUST_PROXY`) was already closed.

**Security review.** Round 1: no critical or high findings; 3 medium and 4 low.
- Fixed:
  - M1: production refused only an unset `TRUST_PROXY`. It now refuses anything that would trust a client-chosen `X-Forwarded-For`: `true`, `0`, `*`, and prefixes shorter than /8 (IPv4) or /32 (IPv6).
  - L3: `OTP_DEV_ECHO` is refused in staging too.
- Sent to the owner (see Deferred): M2 (anyone can use up the SMS budget), M3 (email aliases), L1 (code spam can lock a user out of sign-in), L2 (no session cap), L4 (invalid refreshes can flood the audit log).
- Round 2: M1 and L3 are closed, and the cooldown change adds no bypass. None of the deferred items blocks the commit; M2 should be settled before real SMS goes live.
