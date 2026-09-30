import { HttpStatus, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Sequelize } from 'sequelize-typescript';

import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import { CHECK_TIMEOUT_MS, HealthService, MAX_OUTSTANDING_CHECKS } from './health.service';

interface Fakes {
  query: jest.Mock;
  ping: jest.Mock;
  redis: { status: string; ping: jest.Mock };
  service: HealthService;
}

function setup(): Fakes {
  const query = jest.fn().mockResolvedValue([{ 1: 1 }]);
  const ping = jest.fn().mockResolvedValue('PONG');
  const redis = { status: 'ready', ping };
  const service = new HealthService({ query } as unknown as Sequelize, redis as unknown as Redis);
  return { query, ping, redis, service };
}

/** Resolves to the AppException readiness() threw, or fails the test. */
async function failure(promise: Promise<unknown>): Promise<AppException> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppException);
  return err as AppException;
}

function never(): Promise<never> {
  return new Promise<never>(() => undefined);
}

describe('HealthService.readiness', () => {
  let debug: jest.SpyInstance;

  beforeEach(() => {
    debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('is ready when MySQL and Redis both answer', async () => {
    const { service, query, ping } = setup();
    await expect(service.readiness()).resolves.toEqual({
      status: 'ready',
      checks: { mysql: 'up', redis: 'up' },
    });
    expect(query).toHaveBeenCalledWith('SELECT 1', expect.objectContaining({ logging: false }));
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('503 PROVIDER_UNAVAILABLE with mysql down when the query fails', async () => {
    const { service, query } = setup();
    query.mockRejectedValue(new Error('connect ECONNREFUSED db.internal:3306'));
    const err = await failure(service.readiness());
    expect(err.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(err.code).toBe(ErrorCode.ProviderUnavailable);
    expect(err.details).toEqual({ checks: { mysql: 'down', redis: 'up' } });
  });

  it('503 with redis down when PING fails', async () => {
    const { service, ping } = setup();
    ping.mockRejectedValue(new Error('NOAUTH redis://:secret@cache.internal:6379'));
    const err = await failure(service.readiness());
    expect(err.details).toEqual({ checks: { mysql: 'up', redis: 'down' } });
  });

  it('503 with redis down when PING returns something other than PONG', async () => {
    const { service, ping } = setup();
    ping.mockResolvedValue('LOADING');
    const err = await failure(service.readiness());
    expect(err.details).toEqual({ checks: { mysql: 'up', redis: 'down' } });
  });

  it('reports redis down without sending PING while the client is not connected', async () => {
    const { service, ping, redis } = setup();
    redis.status = 'reconnecting';
    const err = await failure(service.readiness());
    expect(err.details).toEqual({ checks: { mysql: 'up', redis: 'down' } });
    expect(ping).not.toHaveBeenCalled();
  });

  it('503 with both down when both fail', async () => {
    const { service, query, ping } = setup();
    query.mockRejectedValue(new Error('down'));
    ping.mockRejectedValue(new Error('down'));
    const err = await failure(service.readiness());
    expect(err.details).toEqual({ checks: { mysql: 'down', redis: 'down' } });
  });

  it('never puts error text, hostnames or versions in the details', async () => {
    const { service, query, ping } = setup();
    query.mockRejectedValue(new Error('ER_ACCESS_DENIED db.internal 8.4.11'));
    ping.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:6379'));
    const err = await failure(service.readiness());
    const text = JSON.stringify(err.getResponse());
    expect(text).not.toMatch(/internal|8\.4\.11|10\.0\.0\.5|6379|ECONNREFUSED|ER_ACCESS/);
    expect(Object.values(err.details?.checks as object)).toEqual(['down', 'down']);
  });

  it('logs a failed check at debug with the error name only', async () => {
    const { service, query } = setup();
    query.mockRejectedValue(new Error('connect ECONNREFUSED db.internal:3306'));
    await failure(service.readiness());
    expect(debug).toHaveBeenCalledWith('Readiness check mysql failed: Error');
    expect(JSON.stringify(debug.mock.calls)).not.toContain('db.internal');
  });

  it('times a slow check out after 1 s and marks only that one down', async () => {
    jest.useFakeTimers();
    const { service, query } = setup();
    query.mockImplementation(never);
    const result = failure(service.readiness());
    await jest.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS - 1);
    let settled = false;
    void result.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    const err = await result;
    expect(err.details).toEqual({ checks: { mysql: 'down', redis: 'up' } });
  });

  it('runs both checks in parallel, each with its own timeout', async () => {
    jest.useFakeTimers();
    const { service, query, ping } = setup();
    query.mockImplementation(never);
    ping.mockImplementation(never);
    const result = failure(service.readiness());
    // Both started before either finished: they are not chained.
    expect(query).toHaveBeenCalledTimes(1);
    expect(ping).toHaveBeenCalledTimes(1);
    // Parallel: both time out at 1 s, not 2 s.
    await jest.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
    const err = await result;
    expect(err.details).toEqual({ checks: { mysql: 'down', redis: 'down' } });
  });

  it('clears the timeout timer once a check answers', async () => {
    jest.useFakeTimers();
    const { service } = setup();
    await service.readiness();
    expect(jest.getTimerCount()).toBe(0);
  });

  describe('single-flight (the endpoint is public and not rate limited)', () => {
    it('concurrent requests share one SELECT 1 and one PING', async () => {
      const { service, query, ping } = setup();
      const results = await Promise.all(Array.from({ length: 50 }, () => service.readiness()));
      expect(results.every((r) => r.status === 'ready')).toBe(true);
      expect(query).toHaveBeenCalledTimes(1);
      expect(ping).toHaveBeenCalledTimes(1);
    });

    it('a hung query cannot keep readiness down: the next caller starts a fresh one', async () => {
      jest.useFakeTimers();
      const { service, query } = setup();
      query.mockImplementationOnce(never);

      const first = failure(service.readiness());
      await jest.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
      expect((await first).details).toEqual({ checks: { mysql: 'down', redis: 'up' } });

      await expect(service.readiness()).resolves.toMatchObject({ status: 'ready' });
      expect(query).toHaveBeenCalledTimes(2);
    });

    it(`never runs more than ${MAX_OUTSTANDING_CHECKS} queries at once, even when they all hang`, async () => {
      jest.useFakeTimers();
      const { service, query } = setup();
      query.mockImplementation(never);

      for (let i = 0; i < 10; i++) {
        const result = failure(service.readiness());
        await jest.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
        expect((await result).details).toEqual({ checks: { mysql: 'down', redis: 'up' } });
      }
      expect(query).toHaveBeenCalledTimes(MAX_OUTSTANDING_CHECKS);
    });

    it('frees a slot once a hung query finally settles', async () => {
      jest.useFakeTimers();
      const { service, query } = setup();
      const finishers: (() => void)[] = [];
      query.mockImplementation(() => new Promise<void>((resolve) => finishers.push(resolve)));

      for (let i = 0; i < MAX_OUTSTANDING_CHECKS; i++) {
        const result = failure(service.readiness());
        await jest.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
        await result;
      }
      finishers[0]();
      await jest.advanceTimersByTimeAsync(0);
      query.mockResolvedValue([]);
      await expect(service.readiness()).resolves.toMatchObject({ status: 'ready' });
      expect(query).toHaveBeenCalledTimes(MAX_OUTSTANDING_CHECKS + 1);
    });

    it('a caller that joins late times out 1 s after the shared check started, not after it joined', async () => {
      jest.useFakeTimers();
      const { service, query } = setup();
      let finish: () => void = () => undefined;
      query.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));

      const first = failure(service.readiness());
      await jest.advanceTimersByTimeAsync(900);
      const late = failure(service.readiness());
      await jest.advanceTimersByTimeAsync(100);
      // Both time out at t = 1 s, even though the late caller only waited 100 ms.
      expect((await first).details).toEqual({ checks: { mysql: 'down', redis: 'up' } });
      expect((await late).details).toEqual({ checks: { mysql: 'down', redis: 'up' } });
      expect(query).toHaveBeenCalledTimes(1);

      // The slow answer at t = 1.5 s is never reported as up.
      await jest.advanceTimersByTimeAsync(500);
      finish();
    });
  });

  it('warns once when a check goes down and once when it comes back, error name only', async () => {
    const warn = jest.mocked(Logger.prototype.warn);
    const { service, query } = setup();
    query.mockRejectedValue(new Error('connect ECONNREFUSED db.internal:3306'));
    await failure(service.readiness());
    await failure(service.readiness());
    await failure(service.readiness());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenLastCalledWith('Readiness check mysql is down: Error');

    query.mockResolvedValue([]);
    await service.readiness();
    await service.readiness();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith('Readiness check mysql is up again');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('db.internal');
  });

  describe('graceful shutdown', () => {
    it('flips to 503 once shutdown has started, without running the checks', async () => {
      const { service, query, ping } = setup();
      await expect(service.readiness()).resolves.toMatchObject({ status: 'ready' });

      service.onModuleDestroy();

      const err = await failure(service.readiness());
      expect(err.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(err.code).toBe(ErrorCode.ProviderUnavailable);
      expect(err.details).toEqual({ status: 'shutting_down' });
      expect(query).toHaveBeenCalledTimes(1);
      expect(ping).toHaveBeenCalledTimes(1);
    });

    it('stays 503 even though MySQL and Redis are still up', async () => {
      const { service } = setup();
      service.onModuleDestroy();
      await failure(service.readiness());
      await failure(service.readiness());
    });
  });
});
