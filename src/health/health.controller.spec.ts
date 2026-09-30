import { HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { Sequelize } from 'sequelize-typescript';

import { AppException } from '../common/exceptions/app.exception';
import { THROTTLER_IP, THROTTLER_USER } from '../common/throttling/throttling.constants';
import { REDIS_CLIENT } from '../infra/redis/redis.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { NoStoreInterceptor } from './no-store.interceptor';

describe('HealthController', () => {
  async function build(): Promise<{ controller: HealthController; service: HealthService }> {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: Sequelize, useValue: { query: jest.fn().mockResolvedValue([]) } },
        {
          provide: REDIS_CLIENT,
          useValue: { status: 'ready', ping: jest.fn().mockResolvedValue('PONG') } as unknown as Redis,
        },
      ],
    }).compile();
    return { controller: moduleRef.get(HealthController), service: moduleRef.get(HealthService) };
  }

  it('liveness returns { status: "ok" }', async () => {
    const { controller } = await build();
    expect(controller.liveness()).toEqual({ status: 'ok' });
  });

  it('readiness returns ready with both checks up', async () => {
    const { controller } = await build();
    await expect(controller.readiness()).resolves.toEqual({
      status: 'ready',
      checks: { mysql: 'up', redis: 'up' },
    });
  });

  it('after shutdown starts, readiness is 503 while liveness stays ok', async () => {
    const { controller, service } = await build();
    service.onModuleDestroy();
    await expect(controller.readiness()).rejects.toBeInstanceOf(AppException);
    await expect(controller.readiness()).rejects.toMatchObject({ status: HttpStatus.SERVICE_UNAVAILABLE });
    expect(controller.liveness()).toEqual({ status: 'ok' });
  });

  it('runs no guards and skips both throttlers', () => {
    const reflector = new Reflector();
    expect(Reflect.getMetadata('__guards__', HealthController)).toBeUndefined();
    for (const handler of [HealthController.prototype.liveness, HealthController.prototype.readiness]) {
      expect(Reflect.getMetadata('__guards__', handler)).toBeUndefined();
    }
    for (const name of [THROTTLER_IP, THROTTLER_USER]) {
      expect(reflector.get<boolean>(`THROTTLER:SKIP${name}`, HealthController)).toBe(true);
    }
  });

  it('applies the no-store interceptor to every route', () => {
    expect(Reflect.getMetadata('__interceptors__', HealthController)).toEqual([NoStoreInterceptor]);
  });
});
