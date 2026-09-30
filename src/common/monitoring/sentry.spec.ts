import * as Sentry from '@sentry/node';
import type { ErrorEvent } from '@sentry/node';

jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  flush: jest.fn().mockResolvedValue(true),
}));

type SentryModule = typeof import('./sentry');

/** Fresh module per test so the "enabled" flag starts off. */
function load(): SentryModule {
  let mod: SentryModule | undefined;
  jest.isolateModules(() => {
    mod = jest.requireActual<SentryModule>('./sentry');
  });
  return mod as SentryModule;
}

describe('Sentry', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is not initialised without SENTRY_DSN, and captureException is a no-op', () => {
    const sentry = load();
    expect(sentry.initSentry({ dsn: undefined, environment: 'test', role: 'api' })).toBe(false);
    sentry.captureException(new Error('x'));
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('initialises with a DSN, collecting no request or user data and no traces', () => {
    const sentry = load();
    expect(sentry.initSentry({ dsn: 'https://key@o1.ingest.sentry.io/1', environment: 'production', role: 'worker' })).toBe(true);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://key@o1.ingest.sentry.io/1',
        environment: 'production',
        tracesSampleRate: 0,
        dataCollection: expect.objectContaining({
          userInfo: false,
          cookies: false,
          httpHeaders: false,
          httpBodies: [],
          urlQueryParams: false,
          stackFrameVariables: false,
        }),
      }),
    );
    sentry.captureException(new Error('boom'));
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('scrubs PII from events before they are sent', () => {
    const { scrubEvent } = load();
    const event = scrubEvent({
      type: undefined,
      request: {
        method: 'POST',
        url: 'https://api.example.com/api/v1/auth/verify-otp?identifier=priya%40example.com',
        headers: { authorization: 'Bearer secret-token' },
        cookies: { session: 'abc' },
        data: { identifier: 'priya@example.com', otp: '482913' },
        query_string: 'identifier=priya%40example.com',
      },
      user: { id: 'u-1', email: 'priya@example.com', ip_address: '203.0.113.9' },
      extra: { contact: { phone: '+919812345678' }, attempt: 2 },
      breadcrumbs: [{ category: 'http', data: { url: 'https://x.test/a?token=t0k3n', token: 't0k3n' } }],
    } as ErrorEvent);
    const json = JSON.stringify(event);
    for (const secret of ['secret-token', 'abc', 'priya', '482913', '+919812345678', '203.0.113.9', 't0k3n']) {
      expect(json).not.toContain(secret);
    }
    expect(event.request).toEqual({ method: 'POST', url: 'https://api.example.com/api/v1/auth/verify-otp' });
    expect(event.user).toEqual({ id: 'u-1' });
    expect(event.extra).toEqual({ contact: { phone: '[REDACTED]' }, attempt: 2 });
  });
});
