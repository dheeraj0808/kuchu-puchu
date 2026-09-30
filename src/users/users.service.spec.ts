import 'reflect-metadata';

import { fakeUser } from '../auth/testing/fakes';
import { type User, UserStatus } from './models/user.model';
import { UsersService } from './users.service';

describe('UsersService.anonymizeAndSoftDelete', () => {
  it('frees email/phone, deactivates and soft-deletes within the transaction', async () => {
    const raw = fakeUser({ email: 'jane@example.com', phone: '+919876543210' }) as unknown as Record<string, unknown>;
    raw.set = (v: Partial<User>): void => {
      Object.assign(raw, v);
    };
    raw.destroy = jest.fn().mockResolvedValue(undefined);
    const user = raw as unknown as User;
    const tx = {} as never;

    await new UsersService({} as never).anonymizeAndSoftDelete(user, tx);

    expect(user.email).toBeNull();
    expect(user.phone).toBeNull();
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.isActive).toBe(false);
    expect(user.status).toBe(UserStatus.Deactivated);
    expect(user.save).toHaveBeenCalledWith({ transaction: tx });
    expect(user.destroy).toHaveBeenCalledWith({ transaction: tx });
  });
});
