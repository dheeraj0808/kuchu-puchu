/**
 * An in-memory stand-in for the Redis commands the OTP limits use: SET NX EX,
 * PTTL, DEL, ZREM and the sliding-window script (EVAL). Time comes from
 * Date.now(), so jest fake timers move the windows.
 */
export function fakeWindowRedis() {
  const strings = new Map<string, { value: string; expiresAt: number }>();
  const zsets = new Map<string, Array<{ score: number; member: string }>>();
  const live = (key: string) => {
    const v = strings.get(key);
    if (v && v.expiresAt <= Date.now()) strings.delete(key);
    return strings.get(key);
  };
  return {
    strings,
    zsets,
    set: jest.fn(async (key: string, value: string, _ex: 'EX', seconds: number, nx?: 'NX') => {
      if (nx && live(key)) return null;
      strings.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
      return 'OK';
    }),
    pttl: jest.fn(async (key: string) => {
      const v = live(key);
      return v ? v.expiresAt - Date.now() : -2;
    }),
    del: jest.fn(async (key: string) => (strings.delete(key) ? 1 : 0)),
    zrem: jest.fn(async (key: string, member: string) => {
      const z = zsets.get(key) ?? [];
      zsets.set(
        key,
        z.filter((e) => e.member !== member),
      );
      return 1;
    }),
    eval: jest.fn(async (_script: string, _n: number, key: string, windowMs: number, limit: number, member: string) => {
      const now = Date.now();
      const z = (zsets.get(key) ?? []).filter((e) => e.score > now - windowMs);
      zsets.set(key, z);
      if (z.length >= limit) return [0, String(now), String(Math.min(...z.map((e) => e.score)))];
      z.push({ score: now, member });
      return [1, String(now), '0'];
    }),
  };
}

export type FakeWindowRedis = ReturnType<typeof fakeWindowRedis>;
