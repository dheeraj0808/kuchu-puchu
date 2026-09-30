import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import { REDIS_CLIENT } from '../infra/redis/redis.module';
import type { CheckStatus, ReadinessChecks, ReadinessResponse } from './dto/health.response';

/** Guide M02: each dependency check gets 1 s, measured separately. */
export const CHECK_TIMEOUT_MS = 1_000;

/** Cap on checks of one dependency running at once, even when earlier ones hang. */
export const MAX_OUTSTANDING_CHECKS = 3;

type CheckName = keyof ReadinessChecks;

interface InflightCheck {
  promise: Promise<void>;
  startedAt: number;
}

class CheckTimeoutError extends Error {
  override name = 'CheckTimeoutError';
}

/**
 * Readiness for the load balancer (guide M02). Pings MySQL and Redis in
 * parallel and reports each one only as up or down, so the response never
 * carries a hostname, error message or server version.
 */
@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly logger = new Logger(HealthService.name);
  private shuttingDown = false;
  /** The newest check still running, if any. Callers share it instead of starting another. */
  private readonly inflight = new Map<CheckName, InflightCheck>();
  private readonly outstanding: Record<CheckName, number> = { mysql: 0, redis: 0 };
  private readonly lastStatus: Record<CheckName, CheckStatus> = { mysql: 'up', redis: 'up' };

  constructor(
    private readonly sequelize: Sequelize,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * First hook Nest runs on SIGTERM (enableShutdownHooks), before the HTTP
   * server, MySQL or Redis close. From here on readiness is 503 while
   * liveness keeps answering 200. The drain window itself is the load
   * balancer's deregistration delay (30 s, Deployment guide).
   */
  onModuleDestroy(): void {
    this.shuttingDown = true;
  }

  async readiness(): Promise<ReadinessResponse> {
    if (this.shuttingDown) {
      throw new AppException(ErrorCode.ProviderUnavailable, { status: 'shutting_down' });
    }
    const [mysql, redis] = await Promise.all([
      this.probe('mysql', () => this.pingMysql()),
      this.probe('redis', () => this.pingRedis()),
    ]);
    const checks: ReadinessChecks = { mysql, redis };
    if (mysql !== 'up' || redis !== 'up') {
      throw new AppException(ErrorCode.ProviderUnavailable, { checks });
    }
    return { status: 'ready', checks };
  }

  private async pingMysql(): Promise<void> {
    await this.sequelize.query('SELECT 1', { type: QueryTypes.SELECT, logging: false });
  }

  private async pingRedis(): Promise<void> {
    // While disconnected, ioredis would queue the PING until it reconnects;
    // every probe during an outage would add one more to that queue.
    if (this.redis.status !== 'ready') throw new Error(`Redis status ${this.redis.status}`);
    const reply = await this.redis.ping();
    if (reply !== 'PONG') throw new Error('Unexpected PING reply');
  }

  /**
   * Runs one check with this caller's own 1 s timeout. Never throws.
   *
   * The endpoint is public and not rate limited, so callers share the check
   * that is already running. A query that outlives its timeout keeps its pool
   * slot until MySQL answers; without sharing, a flood of probes could queue
   * enough of them to starve the pool for real traffic. A check older than the
   * timeout is stale and the next caller starts a fresh one, so a single hung
   * query (mysql2 has no query timeout) can't keep readiness down on its own;
   * at most MAX_OUTSTANDING_CHECKS per dependency ever run at once.
   */
  private async probe(name: CheckName, check: () => Promise<void>): Promise<CheckStatus> {
    const running = this.shared(name, check);
    // Measured from when the shared check started, so a late joiner can't
    // report up for a check that took longer than 1 s.
    const remainingMs = Math.max(0, running.startedAt + CHECK_TIMEOUT_MS - Date.now());
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new CheckTimeoutError()), remainingMs);
    });
    try {
      await Promise.race([running.promise, timeout]);
      this.record(name, 'up');
      return 'up';
    } catch (err) {
      this.record(name, 'down', err);
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }

  private shared(name: CheckName, check: () => Promise<void>): InflightCheck {
    const latest = this.inflight.get(name);
    const fresh = latest && Date.now() - latest.startedAt < CHECK_TIMEOUT_MS;
    if (latest && (fresh || this.outstanding[name] >= MAX_OUTSTANDING_CHECKS)) return latest;

    this.outstanding[name] += 1;
    const entry: InflightCheck = {
      startedAt: Date.now(),
      promise: check().finally(() => {
        this.outstanding[name] -= 1;
        if (this.inflight.get(name) === entry) this.inflight.delete(name);
      }),
    };
    this.inflight.set(name, entry);
    return entry;
  }

  /**
   * Request logs for health checks are debug only (M02), so a dependency going
   * down or coming back is logged once at warn, when it changes.
   * Error name only: messages can contain hostnames or connection URLs.
   */
  private record(name: CheckName, status: CheckStatus, err?: unknown): void {
    const reason = err instanceof Error ? err.name : 'unknown';
    if (status === 'down') this.logger.debug(`Readiness check ${name} failed: ${reason}`);
    if (this.lastStatus[name] === status) return;
    this.lastStatus[name] = status;
    if (status === 'down') this.logger.warn(`Readiness check ${name} is down: ${reason}`);
    else this.logger.warn(`Readiness check ${name} is up again`);
  }
}
