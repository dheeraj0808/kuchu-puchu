import 'reflect-metadata';

import { UniqueConstraintError } from 'sequelize';

import { IdentifierType } from '../auth/models/otp-verification.model';
import { fakeUser } from '../auth/testing/fakes';
import { type User, UserStatus } from './models/user.model';
import { IdentifierUnavailableError, UsersService } from './users.service';

function setup() {
  const userModel = {
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn().mockResolvedValue([1]),
    unscoped: jest.fn(),
  };
  userModel.unscoped.mockReturnValue(userModel);
  const redis = { set: jest.fn() };
  const service = new UsersService(
    userModel as never,
    {} as never,
    redis as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, userModel, redis };
}

describe('UsersService', () => {
  it('normalises the identifier before a lookup', async () => {
    const s = setup();
    s.userModel.findOne.mockResolvedValue(null);
    await s.service.findByIdentifier(IdentifierType.Phone, '98123 45678');
    await s.service.findByIdentifier(IdentifierType.Email, ' Jane@Example.com');
    expect(s.userModel.findOne.mock.calls.map((c) => c[0].where)).toEqual([
      { phone: '+919812345678' },
      { email: 'jane@example.com' },
    ]);
  });

  it('createVerified inserts a normalised identifier', async () => {
    const s = setup();
    const user = fakeUser();
    s.userModel.create.mockResolvedValue(user);
    await expect(s.service.createVerified(IdentifierType.Phone, '09812345678')).resolves.toEqual({ user, created: true });
    expect(s.userModel.create.mock.calls[0][0]).toMatchObject({ phone: '+919812345678' });
  });

  it('createVerified returns the existing user on a unique-key violation (locking re-read)', async () => {
    const s = setup();
    const existing = fakeUser();
    s.userModel.create.mockRejectedValue(new UniqueConstraintError({}));
    s.userModel.findOne.mockResolvedValue(existing);
    const tx = { LOCK: { SHARE: 'SHARE' } } as never;
    await expect(s.service.createVerified(IdentifierType.Email, 'a@b.co', tx)).resolves.toEqual({ user: existing, created: false });
    expect(s.userModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: 'SHARE', transaction: tx, paranoid: false }),
    );
  });

  it('createVerified refuses an identifier held by a soft-deleted row (no 500) and logs the user id only', async () => {
    const s = setup();
    const deleted = fakeUser({ deletedAt: new Date(), email: 'a@b.co' });
    s.userModel.create.mockRejectedValue(new UniqueConstraintError({}));
    s.userModel.findOne.mockResolvedValue(deleted);
    const warn = jest.spyOn((s.service as unknown as { logger: { warn: jest.Mock } }).logger, 'warn').mockImplementation();
    await expect(s.service.createVerified(IdentifierType.Email, 'a@b.co')).rejects.toBeInstanceOf(
      IdentifierUnavailableError,
    );
    expect(warn).toHaveBeenCalledWith({ userId: deleted.id }, expect.any(String));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('a@b.co');
  });

  it('touchLastActive updates only when the throttle key was newly set, and never throws', async () => {
    const s = setup();
    s.redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('down'));
    await expect(s.service.touchLastActive('u1')).resolves.toBe(true);
    await expect(s.service.touchLastActive('u1')).resolves.toBe(false);
    await expect(s.service.touchLastActive('u1')).resolves.toBe(false);
    expect(s.redis.set).toHaveBeenCalledWith('kp:active:u1', '1', 'EX', 300, 'NX');
    expect(s.userModel.update).toHaveBeenCalledTimes(1);
  });

  it('anonymizeAndSoftDelete frees email/phone, deactivates and soft-deletes within the transaction', async () => {
    const raw = fakeUser({ email: 'jane@example.com', phone: '+919876543210' }) as unknown as Record<string, unknown>;
    raw.set = (v: Partial<User>): void => {
      Object.assign(raw, v);
    };
    raw.destroy = jest.fn().mockResolvedValue(undefined);
    const user = raw as unknown as User;
    const tx = {} as never;
    await setup().service.anonymizeAndSoftDelete(user, tx);
    expect(user.email).toBeNull();
    expect(user.phone).toBeNull();
    expect(user.status).toBe(UserStatus.Deactivated);
    expect(user.save).toHaveBeenCalledWith({ transaction: tx });
    expect(user.destroy).toHaveBeenCalledWith({ transaction: tx });
  });
});
