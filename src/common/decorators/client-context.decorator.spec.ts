import type { Request } from 'express';

import { extractRequestContext } from './client-context.decorator';

const req = (headers: Record<string, string | string[]>, ip = '203.0.113.9'): Request =>
  ({ ip, headers }) as unknown as Request;

describe('extractRequestContext (@ClientContext)', () => {
  it('reads ip, user agent and the three client headers', () => {
    expect(
      extractRequestContext(
        req({
          'user-agent': 'KuchuPuchu/1.4.0 (Android 14)',
          'x-app-version': '1.4.0',
          'x-platform': 'Android',
          'x-device-id': 'a1b2c3d4-e5f6',
        }),
      ),
    ).toEqual({
      ipAddress: '203.0.113.9',
      userAgent: 'KuchuPuchu/1.4.0 (Android 14)',
      appVersion: '1.4.0',
      platform: 'android',
      deviceId: 'a1b2c3d4-e5f6',
    });
  });

  it('returns undefined for missing headers instead of failing', () => {
    expect(extractRequestContext(req({}))).toEqual({
      ipAddress: '203.0.113.9',
      userAgent: null,
      appVersion: undefined,
      platform: undefined,
      deviceId: undefined,
    });
  });

  it('returns undefined for malformed or unknown values', () => {
    const ctx = extractRequestContext(
      req({ 'x-app-version': '1.0; DROP TABLE', 'x-platform': 'windows', 'x-device-id': 'bad id!', 'user-agent': 'x' }),
    );
    expect(ctx.appVersion).toBeUndefined();
    expect(ctx.platform).toBeUndefined();
    expect(ctx.deviceId).toBeUndefined();
  });

  it('trims values, ignores blanks and caps the user agent', () => {
    const ctx = extractRequestContext(
      req({ 'x-app-version': '  2.0.1 ', 'x-platform': '  ', 'user-agent': 'u'.repeat(600) }),
    );
    expect(ctx.appVersion).toBe('2.0.1');
    expect(ctx.platform).toBeUndefined();
    expect(ctx.userAgent).toHaveLength(512);
  });

  it('uses the first value of a repeated header', () => {
    expect(extractRequestContext(req({ 'x-platform': ['ios', 'android'] })).platform).toBe('ios');
  });
});
