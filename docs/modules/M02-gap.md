# M02 Health: gap checklist

| | |
|---|---|
| Date | 2026-09-30 |
| Spec | `backend/docs/Kuchu-Puchu-Backend-Developer-Guide.pdf` v1.0: §8 M02 (endpoints and "Done when"), plus the §4.1 bodies, §4.4 logging rule and the S1–S12 baseline where M02 touches them. The Deployment guide (`documentation/updated-pdf/…Deployment-Security-Operations-Guide.pdf`) sets the load balancer health check path to `/api/v1/health/ready` with a 30 s deregistration delay. |
| Scope | M02 only. |
| Status key | **done**: matches the spec · **partial**: exists but differs from the spec · **missing**: not in the code |

Paths are relative to `backend/`. Test names below are the `it(...)` titles.

## Before: what existed

One endpoint, `GET /api/v1/health` in `src/health/health.controller.ts`, returning `{ status: 'ok' }` (wrapped by `ResponseInterceptor`). It skipped both throttlers and had no auth guard. Its request log was dropped completely by `autoLogging.ignore` in `src/common/logging/logger.module.ts`. There was no readiness endpoint, no dependency check and no shutdown handling.

## Checklist

| # | Item | Before | After | Where | How verified |
|---|---|---|---|---|---|
| 1 | `GET /api/v1/health` liveness: 200 while the process runs, no dependency checked | **partial** | [x] | `src/health/health.controller.ts` (`liveness`) | e2e "checks no dependencies: still 200 while MySQL and Redis are down" (asserts neither client is called) |
| 2 | Liveness body: §4.1 success body, `data: { status: "ok" }` | **done** | [x] | same | e2e "200 with the §4.1 success body and no-store, without an auth header" (`toEqual`) |
| 3 | `GET /api/v1/health/ready` readiness | **missing** | [x] | `health.controller.ts` (`readiness`), `src/health/health.service.ts` | e2e readiness suite |
| 4 | MySQL check `SELECT 1` and Redis check `PING`, run in parallel | **missing** | [x] | `HealthService.readiness` (`Promise.all`) | unit "runs both checks in parallel, each with its own timeout" (both started before either settles; both time out at 1 s, not 2 s) |
| 5 | Each check has its own 1 s timeout | **missing** | [x] | `HealthService.probe` | unit "times a slow check out after 1 s and marks only that one down"; e2e "503 when a check takes longer than 1 s" (answer between 950 ms and 1500 ms) |
| 6 | Both up → 200, `data: { status: "ready", checks: { mysql: "up", redis: "up" } }` | **missing** | [x] | `HealthService.readiness` | e2e "200 with both checks up against the real MySQL and Redis" |
| 7 | Either down or timed out → 503 §4.1 error body, `PROVIDER_UNAVAILABLE`, `details: { checks: { mysql, redis } }` | **missing** | [x] | same | e2e "503 … when MySQL is down", "… when Redis is down", "… longer than 1 s" (exact body incl. `requestId`) |
| 8 | Check values are only `up` / `down`: no hostnames, error messages or versions | **missing** | [x] | `probe` returns only `up`/`down`; logs carry the error name only | unit "never puts error text, hostnames or versions in the details", "logs a failed check at debug with the error name only"; e2e bodies asserted not to contain the injected host/port/version |
| 9 | After SIGTERM, readiness answers 503 at once; liveness stays 200 | **missing** | [x] | `HealthService.onModuleDestroy`: SIGTERM → `app.close()` in `src/bootstrap/run-role.ts`, and Nest runs `onModuleDestroy` first, before the HTTP server, MySQL or Redis close | unit "flips to 503 once shutdown has started, without running the checks"; controller unit "after shutdown starts, readiness is 503 while liveness stays ok" |
| 10 | Both endpoints public: no `JwtAuthGuard` | **partial** | [x] | no `@UseGuards` on `HealthController` | controller unit "runs no guards and skips both throttlers"; e2e "needs no auth: an invalid bearer token is ignored" for both paths |
| 11 | Both endpoints skip every rate limit (per-IP and per-user) | **partial** | [x] | `@SkipThrottle(SKIP_ALL_THROTTLERS)` on the controller | e2e "150 rapid calls never return 429" (150 per endpoint, half with a valid access token so the per-user throttler would count them) |
| 12 | `Cache-Control: no-store` on every response, 200 and 503 | **missing** | [x] | `src/health/no-store.interceptor.ts` (set before the handler, kept by the exception filter) | e2e asserts the header on liveness 200, readiness 200 and every 503 |
| 13 | Request logs at debug only, never info | **partial** | [x] | `src/common/logging/request-log-level.ts`, `customLogLevel` in `logger.module.ts` | unit `request-log-level.spec.ts`; manual run of `dist/main` with `LOG_LEVEL=info`: no health lines, `/api/v1/interests` logged at 30; with `LOG_LEVEL=debug`: health lines at level 20 |
| 14 | Swagger documented | **partial** | [x] | `health.controller.ts`, `src/health/dto/health.response.ts` | e2e "are documented in Swagger as public operations" (liveness 200, readiness 200 + 503, no `security`) |
| 15 | Only one health implementation (old endpoint replaced, not duplicated) | n/a | [x] | old `check()` handler replaced by `liveness()`; old `autoLogging.ignore` removed | `/api/v1/health` routes to the one controller; `test/app.e2e-spec.ts` prefix test still passes against it |

## "Done when" criteria

| # | Criterion | Before | After | How verified |
|---|---|---|---|---|
| D1 | Both endpoints excluded from rate limits and auth | **partial** | [x] | e2e "150 rapid calls never return 429 (per-IP and per-user limits skipped)": 300 calls, all 200, half carrying a valid JWT. e2e "needs no auth" for both paths, plus the liveness and readiness tests sent without an `Authorization` header. Controller unit test asserts no guards and `THROTTLER:SKIP` for both throttlers. |
| D2 | Readiness returns 503 when the DB is down | **missing** | [x] | e2e "503 PROVIDER_UNAVAILABLE when MySQL is down" against the real test app (MySQL query rejected at the Sequelize client): 503, `details.checks = { mysql: "down", redis: "up" }`, no error text in the body. Unit tests cover a failing query, a hung query (timeout) and recovery. |

## Decisions

- **Shutdown response.** After SIGTERM readiness returns 503 `PROVIDER_UNAVAILABLE` with `details: { status: "shutting_down" }`, not `checks`, because the checks aren't run. Both shapes are in Swagger.
- **No in-app drain delay.** The flag flips at `onModuleDestroy`; the drain window is the load balancer's deregistration delay (30 s, Deployment guide). Adding a delay would need a new env var in Appendix D.
- **Shared, bounded checks (security review, S4).** The endpoint is public and unthrottled, so concurrent callers share the check already running. A check older than 1 s is stale and the next caller starts a fresh one. At most 3 checks per dependency run at once, so at most 3 of the 20 pool slots. Each caller's deadline is the shared check's start + 1 s.
- **Redis not connected = down.** No PING is sent unless the client status is `ready`, so ioredis's offline queue doesn't grow during an outage.
- **Outage visibility.** Request logs stay debug only, as required. `HealthService` logs one warn line when a check goes down and one when it comes back, error name only.

## Later

- **Monotonic clock for readiness timeouts.** `HealthService.probe()` and `shared()` measure `startedAt`, the remaining timeout and staleness with `Date.now()`, which follows the wall clock. If the clock steps backwards (NTP correction), a caller joining a hung check could wait longer than 1 s and the staleness window would stretch by the same amount. Replace `Date.now()` with `performance.now()`. Raised by the round-3 security review; optional hardening, not a spec deviation.
- **Stale comment.** The `onModuleDestroy` doc comment in `src/health/health.service.ts` still says SIGTERM is handled by `enableShutdownHooks`. Since M01 Part C, `src/bootstrap/run-role.ts` handles SIGTERM and calls `app.close()`, which still runs `onModuleDestroy` first, so behaviour is unchanged. Only the comment needs updating.
