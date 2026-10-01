import { OnboardingService } from './onboarding.service';

const step = (done: boolean) => ({ isDone: jest.fn().mockResolvedValue(done) });

describe('OnboardingService', () => {
  it.each([
    [[false, false, false, false], 'selfie'],
    [[true, false, false, false], 'photos'],
    [[true, true, false, false], 'profile'],
    [[true, true, true, false], 'preferences'],
    [[true, true, true, true], 'done'],
  ])('%j → %s', async (flags, expected) => {
    const providers = flags.map(step);
    const service = new OnboardingService(...(providers as [never, never, never, never]));
    await expect(service.nextStep('u1')).resolves.toBe(expected);
  });

  it('stops at the first step that is not done', async () => {
    const providers = [step(false), step(true), step(true), step(true)];
    await new OnboardingService(...(providers as [never, never, never, never])).nextStep('u1');
    expect(providers[1].isDone).not.toHaveBeenCalled();
  });

  it('status: selfieApproved only once the selfie step is done', async () => {
    const pending = new OnboardingService(...([step(false), step(true), step(true), step(true)] as [never, never, never, never]));
    await expect(pending.status('u1')).resolves.toEqual({ selfieApproved: false, nextStep: 'selfie' });
    const approved = new OnboardingService(...([step(true), step(false), step(true), step(true)] as [never, never, never, never]));
    await expect(approved.status('u1')).resolves.toEqual({ selfieApproved: true, nextStep: 'photos' });
  });
});
