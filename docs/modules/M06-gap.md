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
| T1 | `otp_verifications.identifier_hash CHAR(64)` = HMAC-SHA256(OTP_HASH_SECRET, "type:normalised") | **done** (`otp.service.ts` `hashIdentifier`) | | |
| T2 | `channel ENUM(sms, email)` | **partial**: `identifier_type ENUM(email, phone)` | | |
| T3 | `purpose ENUM(login, reauth)` | **missing** | | |
| T4 | `otp_hash`, `attempts`, `expires_at`, `consumed_at`, `request_ip VARCHAR(45)` | **partial**: present; `request_ip` nullable; extra `user_id`, `max_attempts`, `updated_at` | | |
| T5 | No `updated_at` | **missing** (has `updated_at`) | | |
| T6 | Indexes `(identifier_hash, created_at)`, `(request_ip, created_at)` | **partial**: `(identifier_hash, identifier_type, created_at)` plus `expires_at`, `user_id` indexes | | |
| T7 | `sessions.previous_token_hash` | **partial**: named `previous_refresh_token_hash` | | |
| T8 | `device_id VARCHAR(100)`, `device_name VARCHAR(100)` | **partial**: VARCHAR(128), nullable | | |
| T9 | `platform ENUM(android, ios)`, `app_version VARCHAR(20)` | **missing** | | |
| T10 | `user_agent VARCHAR(255)` | **partial**: VARCHAR(512) | | |
| T11 | `expires_at` sliding (+30 d per refresh) | **partial**: fixed `JWT_REFRESH_EXPIRES_IN` (7 d) | | |
| T12 | `absolute_expires_at` = created_at + 90 d, never extended | **missing** | | |
| T13 | `reauthenticated_at` | **missing** | | |
| T14 | `revoked_reason VARCHAR(40)`: logout, logout_all, replaced, reuse_detected, restricted, deleted | **partial**: VARCHAR(64); values `replaced_by_new_login`, `refresh_token_reuse`, `account_restricted`, `account_deleted` | | |
| T15 | Indexes `(user_id, revoked_at)`, `(user_id, device_id)` | **partial**: both, plus `expires_at` and a unique `refresh_token_hash` | | |
| T16 | FK `sessions.user_id` → users, ON DELETE RESTRICT (guide §4.2) | **partial**: CASCADE | | |

## Endpoints (under `/api/v1`)

| # | Endpoint | Before | After | Where / how verified |
|---|---|---|---|---|
| E1 | `POST /auth/otp/request` `{channel, identifier}`, always the same 200 | **partial**: `POST /auth/request-otp` `{identifierType, identifier}`; banned users get no code but the same 200 | | |
| E2 | `POST /auth/otp/verify` `{channel, identifier, otp, deviceId, deviceName, platform, appVersion}` → `{accessToken, refreshToken, expiresIn, user, isNewUser, nextStep}` | **partial**: `POST /auth/verify-otp`; device fields optional, no platform/appVersion; response has `tokenType`, `accessTokenExpiresIn`, `refreshTokenExpiresAt`, no `isNewUser`/`nextStep` | | |
| E3 | `POST /auth/refresh` `{refreshToken}` → new pair | **partial**: rotates; reuse revokes only that session; error `INVALID_REFRESH_TOKEN` (not in Appendix C) | | |
| E4 | `POST /auth/logout` `{refreshToken}`, always 200 | **done** | | |
| E5 | `POST /auth/logout-all` | **done** | | |
| E6 | `GET /auth/me` account summary + `nextStep` | **partial**: no `nextStep` | | |
| E7 | `GET /auth/sessions` | **missing** | | |
| E8 | `DELETE /auth/sessions/:sessionId` (404 if not the caller's) | **missing** | | |
| E9 | `POST /auth/reauth/request` | **missing** | | |
| E10 | `POST /auth/reauth/verify` `{otp}` | **missing** | | |
| E11 | Old routes `/auth/request-otp`, `/auth/verify-otp` removed, no aliases | — | | |

There is no separate `/me` route in the code; `GET /auth/me` is the spec's endpoint E6 and stays (with a new field).

## Rules

| # | Rule | Before | After | Where / how verified |
|---|---|---|---|---|
| R1 | 6 digits, CSPRNG | **done** (`crypto.util.ts` `randomInt`) | | |
| R2 | Valid 5 min, 5 attempts, atomic `attempts + 1 WHERE attempts < max` | **done** | | |
| R3 | Constant-time compare | **done** (`timingSafeEqualHex`) | | |
| R4 | Consumed once by a conditional update | **done** | | |
| R5 | One active code per identifier (a new code expires older ones) | **partial**: expires older codes, but two parallel requests can both pass the cooldown check and leave two active codes | | |
| R6 | 60 s cooldown → 429 `OTP_COOLDOWN` + `retryAfterSeconds` | **partial**: DB read, racy (see R5) | | |
| R7 | 5 codes / hour per identifier; 20 / hour per IP (config) | **partial**: per-IP cap is a constant, not `OTP_MAX_PER_IP_PER_HOUR` | | |
| R8 | HTTP throttle: request 5/min per IP, verify 10/min per IP | **done** | | |
| R9 | No enumeration: same 200 for unknown, known, banned, deleted; same 401 `OTP_INVALID` for every verify failure | **partial**: same body, but banned users skip the cooldown and caps, so a second request within 60 s answers 200 for them and 429 for others | | |
| R10 | Banned/suspended + correct code → 403 `ACCOUNT_RESTRICTED`, no tokens | **partial**: banned users never receive a code, so the rule can't be reached | | |
| R11 | SMS country allowlist (`OTP_SMS_ALLOWED_COUNTRIES`, +91) | **missing** | | |
| R12 | Daily global SMS budget (`SMS_DAILY_BUDGET`, Redis per IST date), alert at 80 %, stop at 100 % | **missing** | | |
| R13 | `SmsProvider` / `EmailProvider` in `src/infra`; SES + fake email; fake SMS; production refuses `SMS_PROVIDER` unset or `fake`; `OTP_DEV_ECHO` refused in production | **partial**: one `DevOtpDeliveryService` that throws in production; echo refused in production | | |
| R14 | Access token HS256, 15 min, claims `{sub, sid, iss, aud}`; role from DB | **partial**: token also carries `role` (ignored by the strategy, read from the session cache) | | |
| R15 | Refresh token `<sessionId>.<64-char secret>`, stored as HMAC, rotated on every use | **done** (secret regex accepts 43–128 chars) | | |
| R16 | Reuse of the previous token → revoke ALL sessions (`reuse_detected`), `auth.token_reuse`, security event, 401 `UNAUTHORIZED` | **partial**: revokes that one session; no event; `INVALID_REFRESH_TOKEN` | | |
| R17 | Concurrent refresh loser treated as reuse | **missing**: loser gets a plain 401 | | |
| R18 | Sliding 30 d / absolute 90 d | **missing** | | |
| R19 | Same deviceId replaces the live session (`replaced`); unseen deviceId → `auth.new_device` | **partial**: replaces; no event; two parallel logins on one device can leave two live sessions | | |
| R20 | Logout always 200; logout-all revokes every session incl. current; every revoke deletes the Redis cache key before returning | **done** | | |
| R21 | `GET /auth/sessions`: name, platform, app version, last used, `current`; other sessions' IPs masked | **missing** | | |
| R22 | Step-up: reauth OTP to own verified identifier; `reauthenticated_at`; `RequireReauth` → 403 `REAUTH_REQUIRED` unless within 10 min; on `DELETE /account` | **missing** (`DELETE /account` has no step-up) | | |
| R23 | `OnboardingService.nextStep`: selfie → photos → profile → preferences → done, provider per step; selfie/photos stubs | **partial**: `OnboardingStatusService` stub returns `selfie` | | |
| R24 | `VerifiedUserGuard` uses it; 403 `ONBOARDING_INCOMPLETE` + `details.nextStep`; not applied to routes yet | **partial**: uses the old stub | | |
| R25 | `user.registered` published in the registration transaction (M03 F1) | **missing**: security event only | | |
| R26 | OTP cleanup hourly (> 24 h); session cleanup daily 21:00 UTC (expired, or revoked > 30 d), batches of 5,000 | **missing** (deferred from M03) | | |
| R27 | Security events: otp requested/verified/failed, login, new device, reuse, logout, logout-all, session revoked, reauth ok/failed, budget and country blocks; identifiers only via `hashIdentifier()` | **partial**: no new-device, reauth, budget or country events; `otp.verified` unused | | |

## Plan

- Two migrations rebuild `otp_verifications` and `sessions` to the spec. Dev has 0 users, so existing rows are deleted and the tables recreated (counts printed by the migration).
- New error handling: refresh failures return Appendix C `UNAUTHORIZED`; `INVALID_REFRESH_TOKEN` is removed.
- Cooldown is an atomic Redis `SET NX EX 60` per identifier (serialises issuance, fixes R5/R6). Caps stay as indexed DB counts.
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
| Types | `UserStatus` lacks `banned` | `banned` exists since M04 |

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
