import { Transaction } from 'sequelize';

import type { OutboxConfig } from '../config/outbox.config';
import { OutboxEvent, OutboxStatus } from './models/outbox-event.model';
import { OutboxPublishError, OutboxService } from './outbox.service';

const USER_ID = '01920000-0000-7000-8000-00000000abcd';

function makeTransaction(finished?: string): Transaction {
  const t = Object.create(Transaction.prototype) as Transaction & { finished?: string };
  t.finished = finished;
  return t;
}

describe('OutboxService.publish', () => {
  const create = jest.fn();
  const service = new OutboxService(
    { create } as unknown as typeof OutboxEvent,
    { payloadMaxBytes: 16_384 } as OutboxConfig,
  );

  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ id: 42 });
  });

  it('writes a pending row in the given transaction and returns its id', async () => {
    const t = makeTransaction();
    await expect(service.publish('user.registered', USER_ID, { userId: USER_ID }, t)).resolves.toBe('42');
    expect(create).toHaveBeenCalledWith(
      {
        eventType: 'user.registered',
        aggregateId: USER_ID,
        payload: { userId: USER_ID },
        status: OutboxStatus.Pending,
        attempts: 0,
      },
      { transaction: t },
    );
  });

  it.each([undefined, null, {}, { transaction: {} }])('throws without a real transaction (%p)', async (t) => {
    await expect(
      service.publish('user.registered', USER_ID, { userId: USER_ID }, t as unknown as Transaction),
    ).rejects.toThrow(/inside the caller’s transaction/);
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['commit', 'rollback'])('throws when the transaction has already finished (%s)', async (finished) => {
    await expect(
      service.publish('user.registered', USER_ID, { userId: USER_ID }, makeTransaction(finished)),
    ).rejects.toThrow(/already finished/);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an unknown event type', async () => {
    await expect(
      service.publish('user.deleted' as 'user.registered', USER_ID, { userId: USER_ID }, makeTransaction()),
    ).rejects.toThrow(OutboxPublishError);
  });

  it.each(['not-a-uuid', USER_ID.toUpperCase(), '', 42])('rejects aggregateId %p', async (id) => {
    await expect(
      service.publish('user.registered', id as string, { userId: USER_ID }, makeTransaction()),
    ).rejects.toThrow(/aggregateId/);
  });

  it.each([null, 'text', [USER_ID]])('rejects a payload that is not an object (%p)', async (payload) => {
    await expect(
      service.publish('user.registered', USER_ID, payload as unknown as { userId: string }, makeTransaction()),
    ).rejects.toThrow(/payload must be an object/);
  });

  it('accepts a payload of exactly the cap and rejects one byte more (UTF-8 bytes, not characters)', async () => {
    const overhead = Buffer.byteLength(JSON.stringify({ userId: '' }));
    const fits = { userId: 'x'.repeat(16_384 - overhead) };
    await expect(service.publish('user.registered', USER_ID, fits, makeTransaction())).resolves.toBe('42');
    // 'é' is 2 bytes: fewer characters than the cap, more bytes.
    const tooBig = { userId: 'é'.repeat(Math.ceil((16_384 - overhead + 1) / 2)) };
    await expect(service.publish('user.registered', USER_ID, tooBig, makeTransaction())).rejects.toThrow(
      /the limit is 16384/,
    );
    expect(create).toHaveBeenCalledTimes(1);
  });
});
