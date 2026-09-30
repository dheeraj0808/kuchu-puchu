import 'reflect-metadata';

import { ProfileField } from './dto/profile-completion.response';
import type { Profile } from './models/profile.model';
import {
  COMPLETION_RULES,
  type CompletionInput,
  MIN_INTERESTS_FOR_COMPLETION,
  ProfileCompletionService,
} from './profile-completion.service';
import { fakeProfile } from './testing/fakes';

const input = (overrides: Partial<Profile> = {}, interestCount = 0): CompletionInput => ({
  ...(fakeProfile(overrides).get() as unknown as CompletionInput),
  interestCount,
});

describe('ProfileCompletionService', () => {
  const svc = new ProfileCompletionService();

  it('weights sum to 100', () => {
    expect(COMPLETION_RULES.reduce((s, r) => s + r.weight, 0)).toBe(100);
  });

  it('returns 0 and every field missing when there is no profile', () => {
    const r = svc.calculate(null);
    expect(r.profileCompletion).toBe(0);
    expect(r.missingFields).toEqual(Object.values(ProfileField));
  });

  it('scores required onboarding fields and lists what is missing', () => {
    const r = svc.calculate(input());
    expect(r.profileCompletion).toBe(40);
    expect(r.missingFields).toEqual(['bio', 'location', 'occupation', 'education', 'interests']);
  });

  it('gives 55 with bio added (location still missing)', () => {
    const r = svc.calculate(input({ bio: 'Hello' }));
    expect(r.profileCompletion).toBe(55);
    expect(r.missingFields).toContain('location');
  });

  it(`treats interests as missing below ${MIN_INTERESTS_FOR_COMPLETION}`, () => {
    const r = svc.calculate(input({}, MIN_INTERESTS_FOR_COMPLETION - 1));
    expect(r.profileCompletion).toBe(40);
    expect(r.missingFields).toContain('interests');
  });

  it(`treats interests as present at ${MIN_INTERESTS_FOR_COMPLETION} or more`, () => {
    const r = svc.calculate(input({}, MIN_INTERESTS_FOR_COMPLETION));
    expect(r.profileCompletion).toBe(60);
    expect(r.missingFields).not.toContain('interests');
    expect(svc.calculate(input({}, 10)).profileCompletion).toBe(60);
  });

  it('reaches 100 when every field is present', () => {
    const r = svc.calculate(
      input({ bio: 'Hi', occupation: 'Dev', education: 'BSc', latitude: 12.97, longitude: 77.59 }, 3),
    );
    expect(r).toEqual({ profileCompletion: 100, missingFields: [] });
  });

  it('gives 80 with everything but interests', () => {
    const r = svc.calculate(input({ bio: 'Hi', occupation: 'Dev', education: 'BSc', latitude: 1, longitude: 2 }, 2));
    expect(r).toEqual({ profileCompletion: 80, missingFields: ['interests'] });
  });

  it('requires both coordinates for location', () => {
    expect(svc.calculate(input({ latitude: 12.9, longitude: null })).missingFields).toContain('location');
  });
});
