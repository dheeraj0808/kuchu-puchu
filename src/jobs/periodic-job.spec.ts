import { type PeriodicJob, PeriodicJobRegistry } from './periodic-job';

const job = (name: string): PeriodicJob => ({ name, schedule: { every: 1000 }, run: async () => undefined });

describe('PeriodicJobRegistry', () => {
  it('registers and returns jobs by name', () => {
    const r = new PeriodicJobRegistry();
    r.register(job('outbox.relay'));
    r.register(job('outbox.cleanup'));
    expect(r.all().map((j) => j.name)).toEqual(['outbox.relay', 'outbox.cleanup']);
    expect(r.get('outbox.relay')?.schedule).toEqual({ every: 1000 });
  });

  it('rejects invalid and duplicate names and late registrations', () => {
    const r = new PeriodicJobRegistry();
    expect(() => r.register(job('Bad-Name'))).toThrow(/Invalid periodic job name/);
    r.register(job('a.b'));
    expect(() => r.register(job('a.b'))).toThrow(/Duplicate periodic job/);
    r.seal();
    expect(() => r.register(job('c'))).toThrow(/after the scheduler started/);
  });
});
