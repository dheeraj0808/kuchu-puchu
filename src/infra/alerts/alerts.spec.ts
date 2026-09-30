import { Logger } from '@nestjs/common';

import { describeRelayError } from '../../events/outbox-relay.service';
import { type Alert, errorClassOf, formatAlert, safeAlertValue } from './alert.provider';
import { FakeAlertProvider } from './fake-alert.provider';
import { LogAlertProvider, WebhookAlertProvider } from './webhook-alert.provider';

const alert: Alert = {
  kind: 'outbox_handler_failed',
  eventType: 'match.created',
  outboxId: '42',
  handler: 'notifications.match_push',
  errorClass: 'TypeError',
};

describe('alert formatting', () => {
  it('is one Slack-friendly line with ids and the error class only', () => {
    expect(formatAlert(alert, 'production')).toBe(
      '[kuchu-puchu production] Outbox handler failed after all retries: event=match.created id=42 handler=notifications.match_push error=TypeError',
    );
    expect(formatAlert({ ...alert, kind: 'outbox_relay_failed', handler: undefined }, 'staging')).toBe(
      '[kuchu-puchu staging] Outbox event could not be relayed: event=match.created id=42 error=TypeError',
    );
  });

  it('replaces anything that is not a plain identifier, so no free text or Slack markup gets through', () => {
    expect(safeAlertValue('<!channel> user@example.com')).toBe('unknown');
    expect(formatAlert({ ...alert, eventType: 'x y', errorClass: '<@U1>' }, 'prod')).not.toMatch(/[<>@ ]x|<@/);
  });

  it('errorClassOf returns the class name, never the message', () => {
    expect(errorClassOf(new TypeError('secret +919812345678'))).toBe('TypeError');
    expect(errorClassOf('a string')).toBe('string');
    const weird = new Error('m');
    weird.name = 'has spaces and PII user@example.com';
    expect(errorClassOf(weird)).toBe('Error');
  });

  it('describeRelayError keeps the class and a safe code, never the message', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:6379'), { code: 'ECONNREFUSED' });
    expect(describeRelayError(err)).toBe('Error (ECONNREFUSED)');
    expect(describeRelayError(Object.assign(new Error('x'), { code: 'bad code; drop table' }))).toBe('Error');
  });
});

describe('WebhookAlertProvider', () => {
  const fetchMock = jest.fn();
  const original = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = original;
    jest.restoreAllMocks();
  });

  it('POSTs { text } as JSON with a timeout and no redirects', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await new WebhookAlertProvider('https://hooks.example.com/x', 'production').send(alert);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hooks.example.com/x');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({ text: formatAlert(alert, 'production') });
  });

  it('never throws when the webhook fails or rejects, and never logs the URL', async () => {
    const provider = new WebhookAlertProvider('https://hooks.example.com/secret-token', 'production');
    fetchMock.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND hooks.example.com/secret-token'));
    await expect(provider.send(alert)).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(provider.send(alert)).resolves.toBeUndefined();
    const logged = JSON.stringify((Logger.prototype.error as jest.Mock).mock.calls);
    expect(logged).not.toContain('secret-token');
  });
});

describe('LogAlertProvider and FakeAlertProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs the alert fields at error level', async () => {
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await new LogAlertProvider().send(alert);
    expect(spy).toHaveBeenCalledWith(
      {
        kind: 'outbox_handler_failed',
        eventType: 'match.created',
        outboxId: '42',
        handler: 'notifications.match_push',
        errorClass: 'TypeError',
      },
      'ALERT',
    );
  });

  it('the fake records alerts', async () => {
    const fake = new FakeAlertProvider();
    await fake.send(alert);
    expect(fake.sent).toEqual([alert]);
    fake.clear();
    expect(fake.sent).toEqual([]);
  });
});
