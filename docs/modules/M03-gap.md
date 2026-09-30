# M03 Events, Outbox & Jobs: gap checklist

| | |
|---|---|
| Date | 2026-10-01 |
| Spec | `backend/docs/Kuchu-Puchu-Backend-Developer-Guide.pdf` v1.0: §8 M03 (table, "How it works", "Done when"), Appendix A (domain events), Appendix B (background jobs). Appendix D was read only to see which env vars it lists. |
| Scope | M03 only. Nothing from other modules is built; side effects that belong to them are listed under "Deferred". |
| Status key | **done**: matches the spec · **partial**: exists but differs from the spec · **missing**: not in the code · [x] done in the code · [ ] not done |

Paths are relative to `backend/`. Test names below are the `it(...)` titles.

## a) What existed before M03

| What | Where | Before | After |
|---|---|---|---|
| Shared BullMQ Redis connection (`QUEUE_CONNECTION`, lazy, `maxRetriesPerRequest: null`, prefix `kp:queue`) | `src/infra/queue/queue-connection.module.ts` | **done**, unused | used by the outbox queue, the handler worker and the scheduler (worker only) |
| Worker process: a keep-alive `setInterval` and a "No queues registered yet (M03)" log | `src/worker.ts` | placeholder | replaced by `JobsModule` + `EventsWorkerModule` + `AlertsModule` |
| Role runner: SIGTERM → `app.close()` → exit 0 (exit 1 after 10 s) | `src/bootstrap/run-role.ts` | **done** | unchanged; the workers close inside `app.close()` |
| UUID column helper (CHAR(36) utf8mb4_bin), `TABLE_OPTIONS_0900` | `src/database/migrations/helpers.ts` | **done** | used by the outbox migration |
| Schema test (CHAR(36) columns utf8mb4_bin, tables 0900_ai_ci) | `test/integration/schema.int-spec.ts` | **done** | covers `outbox_events` automatically |
| `outbox_events`, OutboxService, event-type map, registry, relay, handler worker, scheduler, alerts | none | **missing** | [x] built (section c) |
| OTP cleanup, session cleanup (Appendix B) | none: nothing deleted those rows | **missing** | deferred to M06 (section b) |
| `ALERT_WEBHOOK_URL` (Appendix D) | not in `env.validation.ts` | **missing** | [x] validated; required in production |

## b) Deferred

Nothing below is built or converted in M03.

### Direct side effects that become outbox events

| # | Where | Today | Appendix A event | Converted by |
|---|---|---|---|---|
| F1 | `src/auth/auth.service.ts:124-157` (user created :128); security event :170-177 | Registration writes only a security event, after the transaction | `user.registered` | **M06** (publish inside the transaction at :124) |
| F2 | `src/auth/services/session.service.ts:111-120` | Refresh-token reuse revokes the session and records a security event. No transaction, no notification. | `auth.token_reuse` | **M06** |
| F3 | `src/auth/services/session.service.ts:52-87` (`create`) | New-device logins aren't detected | `auth.new_device` | **M06** |
| F4 | `src/auth/services/session.service.ts:113-114` (reuse revoke), `:128-129` (restricted on refresh), `:172-206` (logout / revoke-all / revoke), `src/auth/auth.service.ts:208-217` (logout-all) | Row update only. There's no session cache yet to invalidate (S3). | none directly: cache invalidation | **M06** |
| F5 | `src/users/users.service.ts:48-59` (status → deactivated) | Status change with no follow-up | `user.status_changed` | **M04 / M15** |
| F6 | `src/account/account.service.ts:35-66` (`deleteAccount`) | One transaction, no email or purges | `account.deleted` | **M07** (must not copy the email into the payload; see §M03 "No PII copies") |
| F7 | `src/profiles/profiles.service.ts:195-201`, `:221-237` | Profile hidden / soft-deleted | none in Appendix A | **M09/M10**, decided there |
| — | `src/auth/auth.service.ts:80-90` → `otp-delivery.service.ts` | OTP send is synchronous on purpose (returns 503 on failure) | **not** an outbox event | M06 (provider adapter only) |

### Jobs and tooling

| Item | Owner | Note |
|---|---|---|
| OTP cleanup (hourly, codes older than 24 h) | **M06** | Register a `PeriodicJob` with `PeriodicJobRegistry` from the auth side of the worker; M06 also picks its run time |
| Session cleanup (daily, expired or revoked > 30 days) | **M06** | Same. M06 changes the session rules (30/90 days), so the job is built with those rules |
| Security-events retention | **M05** | Same mechanism |
| Admin replay of `failed` outbox rows | **M15** | Failed rows stay until someone acts; the cleanup never deletes them |

## Decisions and deviations

| # | Topic | Decision | Guide wording / note |
|---|---|---|---|
| X1 | Folder | `src/events/`, `src/jobs/`, `src/infra/alerts/`, following the repo layout (`src/<module>`) | Guide §3.4 shows `src/modules/<module>` |
| X2 | jobId | `<outboxId>-<handlerName>`. BullMQ 6.3.10 rejects ids that contain exactly one `:` (`node_modules/bullmq/dist/cjs/classes/job.js:910-913`). Handler names are `[a-z0-9_.]{1,64}` and unique across the app; `HandlerRegistry` enforces both at registration and seals at worker start, so a bad handler fails the worker at boot. | — |
| X3 | `last_error` / `attempts` | Record **relay** failures only (Redis refused or timed out). Handler failures live in BullMQ's failed set plus the alert. `last_error` holds the error class and a safe code only (e.g. `Error (ECONNREFUSED)`), never the message, because Redis messages include hosts. | **Deliberate deviation**: the guide's column note says "Last handler error message" |
| X4 | Throughput | One tick keeps taking batches of `OUTBOX_BATCH_SIZE` until one comes back short, Redis fails, or `OUTBOX_RELAY_TIME_BUDGET_MS` (800 ms, which must be below the interval) runs out | — |
| X5 | Run times | Outbox cleanup `30 21 * * *` UTC (03:00 IST), in the outbox config (`OUTBOX_CLEANUP_CRON`). OTP/session times are set in M06. | Appendix B says only "daily" |
| X6 | Alerts | `ALERT_WEBHOOK_URL` is required in production (boot fails without it). Elsewhere, when unset, `LogAlertProvider` logs at error level. The body is Slack-compatible: `{ "text": "…" }`. Alerts carry the kind, event type, id, handler and error class; every value is restricted to `[A-Za-z0-9_.:-]`. | — |
| X7 | Retention | Completed handler jobs kept 24 h (this is also the jobId dedupe window); failed jobs kept 14 days. Both are configurable. Failed outbox rows are kept until someone acts. | — |
| X8 | Relay backoff | `available_at = NOW(3) + base × 2^attempts` (base 1 s, so 2^attempts s), computed with the DB clock | — |
| X9 | Enqueue timeout | `OUTBOX_ENQUEUE_TIMEOUT_MS` (1 s). With Redis down, ioredis queues commands instead of failing, so without a timeout the relay would hold its row locks indefinitely. A late add after the timeout is harmless because of jobId dedupe. | Added; not in the guide |
| X11 | Alert volume | Relay failures send **one alert per batch** (first id + `count`; `eventType` is `mixed` when the batch has several types). Handler failures send one alert per (handler, error class) per 5 min; repeats held back in that window are counted into the next alert (`count`). Every failure is still logged. Alerts are sent after the commit and not awaited. | Security review #4 |
| X12 | Relay locking | Each relay batch runs at READ COMMITTED (no gap locks), so a relay waiting on Redis never blocks `publish()` inserts | Security review #2 / audit #3 |
| X13 | Producer connection | The relay's queue has its own Redis connection with `enableOfflineQueue: false`. An add is only sent when the connection is ready, and never after the enqueue timeout fired, so no batch is parked in memory and delivered after its rows were counted failed. | Security review #3 |
| X14 | Errors stored in Redis | Handler and tick errors are rethrown as their class only (`src/jobs/job-errors.ts`) and jobs use `stackTraceLimit: 0`, so BullMQ's `failedReason`/stack never hold user data. Failed handler jobs are also capped at 10,000. | Security review #1, #5 |
| X15 | Invalid rows | A row with an unknown event type or a non-object payload (e.g. written by hand) is marked `failed` (`OutboxInvalidRow`) with an alert instead of stalling the relay | Security review #6 |
| X16 | Backoff exponents | Relay retry after 2^attempts s (first retry 2 s). BullMQ handler retry n after 2^(n-1) s (first retry 1 s). Both come from `OUTBOX_BACKOFF_BASE_MS`. | Audit #8 |
| X17 | Tick overlap | A tick stops taking batches at its budget, and the enqueue wait is capped at the remaining budget (floor 100 ms), so a tick ends at about 800 ms plus DB time. BullMQ can still start the next tick in a second slot if one runs long; SKIP LOCKED keeps that safe. | Audit #4 |
| X18 | Scheduler retention | `scheduled-jobs` keeps the last 100 completed ticks (count, not 24 h: the relay alone makes 86,400 a day) and failed ticks 14 d (max 1,000) | Audit #9 |
| X19 | Stalled handler jobs | In BullMQ 6.3.10 a job stalled past `maxStalledCount` is failed on its next pickup (deferred failure, `UnrecoverableError`), so it alerts through the normal failed path. Stalls themselves are logged. | Audit #5 (re-audit: no separate branch needed) |
| X10 | Auto-increment reuse | jobIds rely on outbox ids never repeating within the 24 h dedupe window. InnoDB never reuses AUTO_INCREMENT values. A restore of MySQL from an older backup while Redis keeps the last 24 h would break this, so flush the `kp:queue:outbox-events:*` keys in that runbook. | Operational note |

## c) What was built

### Migration

`src/database/migrations/20261003000001-create-outbox-events.ts`, idempotent, `TABLE_OPTIONS_0900`:

| Column | Definition |
|---|---|
| `id` | `BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY` |
| `event_type` | `VARCHAR(64) NOT NULL` (validated in code, §4.2) |
| `aggregate_id` | `uuidColumn()`, i.e. CHAR(36) utf8mb4_bin |
| `payload` | `JSON NOT NULL` |
| `status` | `ENUM('pending','done','failed') NOT NULL DEFAULT 'pending'` |
| `attempts` | `TINYINT UNSIGNED NOT NULL DEFAULT 0` |
| `available_at` | `DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)` |
| `last_error` | `VARCHAR(500) NULL` |
| `created_at` | `DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`. No `updated_at`. |
| index | `outbox_events_status_available_idx (status, available_at)` |

### Files

| File | What |
|---|---|
| `src/events/event-types.ts` | `EventPayloads` for all 27 Appendix A names (ids only); a `Record<EventType, true>` makes the compiler reject a missing or extra name; `isEventType()` |
| `src/events/models/outbox-event.model.ts` | Model, `updatedAt: false` |
| `src/events/outbox.service.ts` | `publish(type, aggregateId, payload, transaction)`. Throws `OutboxPublishError` without a Sequelize `Transaction`, with a finished one, for an unknown type, a non-UUID aggregate id, a non-object payload, or JSON over `OUTBOX_PAYLOAD_MAX_BYTES` UTF-8 bytes |
| `src/events/handler-registry.ts` | `EventHandler` interface (idempotency contract in its doc comment), `DeliveredEvent`, `HandlerRegistry` |
| `src/events/outbox-relay.service.ts` | Relay (SKIP LOCKED batches, addBulk with jobIds, mark done, retry/fail + alert), time budget, enqueue timeout, graceful stop |
| `src/events/outbox-handler.worker.ts` | BullMQ worker for `outbox-events`; final failure → alert |
| `src/events/outbox-jobs.ts` | `OutboxRelayJob` (`outbox.relay`, every 1 s) and `OutboxCleanupJob` (`outbox.cleanup`, cron, 5,000-row batches) |
| `src/events/events.module.ts` | `OutboxService` for publishers (no Redis) |
| `src/events/events-worker.module.ts` | Worker-only delivery side; registers the two periodic jobs |
| `src/events/outbox.constants.ts` | Tokens, queue name, `outboxJobId()` |
| `src/jobs/periodic-job.ts` | `PeriodicJob`, `PeriodicJobRegistry` |
| `src/jobs/job-scheduler.service.ts` | `upsertJobScheduler` per registered job (cron in UTC), removes stale schedulers, one worker dispatching by job name |
| `src/jobs/close-worker.ts` | Drain with timeout (2.5 s per worker), bounded queue close (0.5 s) |
| `src/jobs/job-errors.ts` | `sanitizeJobError`: keep only the error class in what BullMQ stores |
| `src/jobs/jobs.module.ts` | Worker-only scheduler module |
| `src/infra/alerts/*` | `AlertProvider`, `WebhookAlertProvider` (3 s timeout, no redirects, never throws, never logs the URL), `LogAlertProvider`, `FakeAlertProvider`, `AlertsModule` |
| `src/config/outbox.config.ts`, `env.validation.ts`, `integrations.config.ts` (`alertsConfig`), `index.ts`, `.env.example` | Typed `outbox` and `alerts` config |
| `src/worker.ts` | Worker wiring |

### Queues and schedules

| Queue | Jobs | Schedule | Retention |
|---|---|---|---|
| `scheduled-jobs` | `outbox.relay` | every `OUTBOX_RELAY_INTERVAL_MS` (1 s) | last 100 completed; failed 14 d (max 1,000) |
| | `outbox.cleanup` | `OUTBOX_CLEANUP_CRON` (`30 21 * * *` UTC) | same |
| `outbox-events` | one job per (event, handler), jobId `<outboxId>-<handler>` | driven by the relay | completed 24 h; failed 14 d |

### Shutdown (worker)

On SIGTERM, `run-role` calls `app.close()`. Nest runs `onModuleDestroy` in this order (checked by the spec audit against Nest 12):

1. The relay refuses new ticks and waits for the in-flight batch transaction (≤ 1.5 s). It then closes its queue and producer connection (≤ 0.5 s).
2. The handler worker stops taking jobs and lets in-flight ones finish (≤ 2.5 s). After that, the job's lock expires and it is retried as stalled.
3. The scheduler worker stops taking ticks and waits for a running one (≤ 2.5 s), then its queue closes (≤ 0.5 s).
4. `onApplicationShutdown`: the shared Redis connections and the MySQL pool close.
5. The process exits 0.

Worst case is 7.5 s before step 4, inside run-role's 10 s `SHUTDOWN_TIMEOUT_MS`.

### Infra vars not in Appendix D

`OUTBOX_RELAY_INTERVAL_MS`, `OUTBOX_RELAY_TIME_BUDGET_MS`, `OUTBOX_BATCH_SIZE`, `OUTBOX_MAX_ATTEMPTS`, `OUTBOX_BACKOFF_BASE_MS`, `OUTBOX_ENQUEUE_TIMEOUT_MS`, `OUTBOX_CLEANUP_AGE_DAYS`, `OUTBOX_CLEANUP_CRON`, `OUTBOX_PAYLOAD_MAX_BYTES`, `OUTBOX_COMPLETED_JOB_RETENTION_HOURS`, `OUTBOX_FAILED_JOB_RETENTION_DAYS`. (`ALERT_WEBHOOK_URL` is in Appendix D.)

## Tests

Final run: unit 450/450, integration 41/41, e2e 24/24. Build, lint and type-check are clean.

Integration tests run on real MySQL 8.4 and Redis DB 15.

| # | Required test | Where | Test |
|---|---|---|---|
| T1 | publish inside a rolled-back transaction → never delivered | `test/integration/outbox-delivery.int-spec.ts` | "an event published in a transaction that rolls back is never delivered" |
| T2 | publish without a transaction → throws | same; unit `src/events/outbox.service.spec.ts` | "publish without a transaction throws and writes nothing"; unit "throws without a real transaction", "…already finished" |
| T3 | happy path: every handler once | same | "happy path: every registered handler runs exactly once with the payload" |
| T4 | failing handler retried with backoff → failed + alert | same | "a failing handler is retried with exponential backoff, then failed with one alert; others are unaffected" |
| T5 | two relays, 500 events → each pair exactly once | same | "two relays running at the same time on 500 events: every (event, handler) pair runs exactly once" |
| T6 | crash after enqueue before done → re-enqueued, once per handler | same | "a crash after enqueue but before marking done re-enqueues the event, and each handler still runs once" |
| T7 | Redis down → attempts, available_at, last_error; 8 → failed + alert | `test/integration/outbox-relay-failure.int-spec.ts` | "updates attempts, available_at (now + 2^attempts s) and last_error; after 8 attempts → failed + one alert", plus "…never answers…", "…delivered once Redis is back…" and "a row not written by publish()…" |
| T8 | repeatable job once per tick with two workers | `test/integration/job-scheduler.int-spec.ts` | "a repeatable job runs once per tick with two worker instances" |
| T9 | cleanup deletes only done > 7 days | same | "deletes only done events older than 7 days", "deletes in batches until one is short" |
| T10 | worker SIGTERM → in-flight job finishes, exit 0 | `test/integration/entrypoints.int-spec.ts` (fixture `test/support/outbox-worker-fixture.ts`) | "worker: on SIGTERM an in-flight handler finishes, then the process exits 0" |
| T11 | the relay never runs in the API process | `test/integration/outbox-api-process.int-spec.ts` | "has no OutboxRelayService…", "creates no BullMQ queues or schedulers in Redis" |

Also covered: no handler registered → marked done with a warning; a tick drains full batches; the time budget stops a tick; stale schedulers are removed. Unit tests cover the registries, event types versus Appendix A, the alert formatting and providers, `describeRelayError`, and the env/config values.

## "Done when" criteria

| # | Criterion | Status | How verified |
|---|---|---|---|
| D1 | An event published in a rolled-back transaction is never delivered | [x] | T1 on real MySQL + Redis. publish → throw → rollback, then the relay runs with a live handler worker. Result: no row, 0 handler runs, 0 jobs in any queue state. T2: publish without a transaction (and with a committed one) throws and writes nothing. Structural: `OutboxService` only inserts through the caller's `Transaction`, and the relay reads only committed rows. |
| D2 | A handler that fails is retried and then marked failed | [x] | T4: a handler that always throws gets attempts 1–8, gaps ≥ base × 2^(n-1), then the BullMQ job state is `failed` with `attemptsMade` 8 and exactly one alert (kind, type, id, handler, `TypeError`; no payload). `failedReason` is `TypeError` with no stack and no email; the other handler for the same event ran once, and the outbox row stayed `done`/0 attempts. Relay-side failures: T7 (8 attempts → `failed` + one batch alert). |
| D3 | Two workers never process the same event at the same time | [x] | T5: two relays run concurrently (SKIP LOCKED, READ COMMITTED) on 500 events with two handler workers. Both relays did work, the 1,000 enqueued jobIds were all distinct, and each of the 1,000 (event, handler) pairs ran exactly once. T6: a crash after enqueue re-enqueues the same jobIds and each handler still ran once. T8: two scheduler instances; every tick slot ran once. |

## d) Questions: resolved 2026-10-01

Q1 folder → X1 · Q2 jobId → X2 · Q3 OTP/session cleanups → deferred to M06 · Q4 last_error → X3 · Q5 throughput → X4 · Q6 times → X5 · Q7 alert webhook → X6 · Q8 failed rows → kept, replay in M15; retention → X7.

## Step 0 status (2026-10-01, before M03)

- `development` was at `fdb5194`, 5 commits ahead of `origin/development` (not pushed). The working tree was clean.
- `backup/before-split` still exists locally (`badbf7b`).
- GitHub Actions: `gh` is not installed, so the run status couldn't be checked.
- M01-gap PENDING: 12.3 (CI green, which waits on a push) and 12.4 (`docker-compose up`, since Docker isn't installed).
