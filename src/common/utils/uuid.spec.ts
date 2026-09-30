import { isUUID } from 'class-validator';

type UuidModule = typeof import('./uuid');

/** Each test gets a fresh module, so the monotonic state starts empty. */
function freshModule(): UuidModule {
  let mod: UuidModule | undefined;
  jest.isolateModules(() => {
    mod = jest.requireActual<UuidModule>('./uuid');
  });
  return mod as UuidModule;
}

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('produces RFC 9562 version 7 ids that fit CHAR(36)', () => {
    const id = freshModule().uuidv7();
    expect(id).toMatch(V7);
    expect(id).toHaveLength(36);
    expect(isUUID(id, '7')).toBe(true);
  });

  it('encodes the creation time in the first 48 bits', () => {
    const { uuidv7, uuidv7Timestamp } = freshModule();
    const now = Date.UTC(2026, 8, 30, 12, 0, 0, 123);
    expect(uuidv7Timestamp(uuidv7(now)).getTime()).toBe(now);
  });

  it('is strictly increasing, also within one millisecond', () => {
    const { uuidv7 } = freshModule();
    const fixed = Date.now();
    const ids = Array.from({ length: 5000 }, () => uuidv7(fixed));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stays increasing when the clock steps backwards', () => {
    const { uuidv7 } = freshModule();
    const t = Date.now();
    const a = uuidv7(t);
    const b = uuidv7(t - 60_000);
    expect(b > a).toBe(true);
  });

  it('is unique across many calls', () => {
    const { uuidv7 } = freshModule();
    const ids = new Set(Array.from({ length: 20_000 }, () => uuidv7()));
    expect(ids.size).toBe(20_000);
  });
});
