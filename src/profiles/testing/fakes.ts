import { randomUUID } from 'node:crypto';

import { type Profile, ProfileVisibility } from '../models/profile.model';

export type FakeProfile = Profile & {
  save: jest.Mock;
  destroy: jest.Mock;
  restore: jest.Mock;
};

/** In-memory stand-in for a Profile instance (set/save/destroy/restore). */
export function fakeProfile(overrides: Partial<Profile> = {}): FakeProfile {
  const p: Record<string, unknown> = {
    id: randomUUID(),
    userId: randomUUID(),
    displayName: 'Priya',
    dateOfBirth: '1998-04-21',
    gender: 'woman',
    bio: null,
    occupation: null,
    education: null,
    city: null,
    state: null,
    country: null,
    latitude: null,
    longitude: null,
    locationUpdatedAt: null,
    isDiscoverable: true,
    profileVisibility: ProfileVisibility.Public,
    profileCompletion: 55,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
  p.set = (keyOrValues: string | Record<string, unknown>, value?: unknown): void => {
    if (typeof keyOrValues === 'string') p[keyOrValues] = value;
    else Object.assign(p, keyOrValues);
  };
  // Mirrors Model#get(): plain attribute values (no methods).
  p.get = (): Record<string, unknown> =>
    Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v !== 'function'));
  p.save = jest.fn(() => Promise.resolve(p));
  p.destroy = jest.fn(() => {
    p.deletedAt = new Date();
    return Promise.resolve();
  });
  p.restore = jest.fn(() => {
    p.deletedAt = null;
    return Promise.resolve();
  });
  return p as unknown as FakeProfile;
}
