import 'reflect-metadata';

import { Logger } from '@nestjs/common';

import { SecurityEventType } from './models/security-event.model';
import { SecurityEventsService, stripPii } from './security-events.service';

describe('stripPii', () => {
  it('drops forbidden keys at any depth and in any case, reporting paths only', () => {
    const dropped: string[] = [];
    const out = stripPii(
      {
        a: 1,
        EMAIL: 'x@y.z',
        n: { Token: 't', list: [{ otp: '1', ok: 2 }], LAT: 1, lng: 2 },
        identifierHashPrefix: 'abc',
      },
      '',
      dropped,
    );
    expect(out).toEqual({
      a: 1,
      n: { list: [{ ok: 2 }] },
      identifierHashPrefix: 'abc',
    });
    expect(dropped.sort()).toEqual(
      ['EMAIL', 'n.LAT', 'n.Token', 'n.list[0].otp', 'n.lng'].sort(),
    );
  });
});

describe('stripPii key variants', () => {
  it('also drops common variants and keeps hash prefixes and the identifier type', () => {
    const out = stripPii({
      accessToken: 'a',
      refresh_token: 'b',
      phoneNumber: '1',
      newEmail: 'e',
      emailAddress: 'e',
      otpCode: '1',
      latitude: 1,
      longitude: 2,
      identifierHashPrefix: 'abc',
      identifierType: 'email',
      sessionId: 's',
    });
    expect(out).toEqual({
      identifierHashPrefix: 'abc',
      identifierType: 'email',
      sessionId: 's',
    });
  });
});

describe('SecurityEventsService.record', () => {
  const config = {
    getOrThrow: () => ({ identifierHashSecret: 's'.repeat(40) }),
  };
  afterEach(() => jest.restoreAllMocks());

  it('never throws into the caller and logs the error class only', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const model = {
      create: jest.fn().mockRejectedValue(
        Object.assign(new Error('Duplicate entry jane@example.com'), {
          name: 'SequelizeDatabaseError',
        }),
      ),
    };
    const service = new SecurityEventsService(model as never, config as never);
    await expect(
      service.record({ eventType: SecurityEventType.Logout }),
    ).resolves.toBeUndefined();
    expect(JSON.stringify(error.mock.calls)).not.toContain('jane@example.com');
    expect(error.mock.calls[0][0]).toMatchObject({
      err: 'SequelizeDatabaseError',
    });
  });

  it('writes in the caller transaction when given one, stores the actor and cuts the user agent to 255', async () => {
    const model = { create: jest.fn().mockResolvedValue(undefined) };
    const service = new SecurityEventsService(model as never, config as never);
    const tx = {} as never;
    await service.record({
      eventType: SecurityEventType.UserStatusChanged,
      userId: 'u',
      actorUserId: 'a',
      context: { ipAddress: '1.2.3.4', userAgent: 'x'.repeat(600) },
      metadata: { phone: '+91', to: 'banned' },
      transaction: tx,
    });
    const [attrs, opts] = model.create.mock.calls[0];
    expect(opts).toEqual({ transaction: tx });
    expect(attrs).toMatchObject({
      userId: 'u',
      actorUserId: 'a',
      metadata: { to: 'banned' },
    });
    expect(attrs.userAgent).toHaveLength(255);
  });

  it('hashIdentifier returns a 12-char hex HMAC prefix', () => {
    const service = new SecurityEventsService({} as never, config as never);
    expect(
      service.hashIdentifier('email' as never, 'jane@example.com'),
    ).toMatch(/^[0-9a-f]{12}$/);
  });

  it('inside a caller transaction, rethrows errors that already rolled it back (deadlock, lost connection)', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const deadlock = Object.assign(new Error('Deadlock'), {
      name: 'SequelizeDatabaseError',
      parent: { errno: 1213 },
    });
    const model = { create: jest.fn().mockRejectedValue(deadlock) };
    const service = new SecurityEventsService(model as never, config as never);
    await expect(
      service.record({
        eventType: SecurityEventType.Logout,
        transaction: {} as never,
      }),
    ).rejects.toBe(deadlock);
    // Without a transaction, or for other errors, it still never throws.
    await expect(
      service.record({ eventType: SecurityEventType.Logout }),
    ).resolves.toBeUndefined();
    model.create.mockRejectedValueOnce(
      Object.assign(new Error('x'), { name: 'SequelizeValidationError' }),
    );
    await expect(
      service.record({
        eventType: SecurityEventType.Logout,
        transaction: {} as never,
      }),
    ).resolves.toBeUndefined();
  });
});
