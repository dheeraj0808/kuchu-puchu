import { redisKey } from './redis-keys';

describe('redisKey', () => {
  it('builds kp:<area>:<id>', () => {
    expect(redisKey('session', 'abc')).toBe('kp:session:abc');
  });

  it('appends extra parts, allowing ":" only in the last one (IPv6, composite ids)', () => {
    expect(redisKey('throttle', 'ip', 'global', '2001:db8::1')).toBe('kp:throttle:ip:global:2001:db8::1');
  });

  it.each([
    ['', ['x']],
    ['a:b', ['x']],
    ['area', []],
    ['area', ['']],
    ['area', ['has space']],
    ['area', ['a:b', 'last']],
  ])('rejects invalid input (area %p, parts %p)', (area, parts) => {
    expect(() => redisKey(area, ...parts)).toThrow();
  });
});
