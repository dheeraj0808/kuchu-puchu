import type { IncomingMessage } from 'node:http';

import { isHealthCheckPath, requestLogLevel } from './request-log-level';

function req(url: string, originalUrl?: string): IncomingMessage {
  return { url, originalUrl } as unknown as IncomingMessage;
}

describe('requestLogLevel', () => {
  it.each([
    '/api/v1/health',
    '/api/v1/health/',
    '/api/v1/health/ready',
    '/api/v1/health/ready/',
    '/api/v1/health/ready?probe=alb',
    '/API/V1/Health/Ready',
  ])('logs health check %s at debug', (url) => {
    expect(isHealthCheckPath(url)).toBe(true);
    expect(requestLogLevel(req(url))).toBe('debug');
  });

  it.each(['/api/v1/healthz', '/api/v1/health/ready/extra', '/api/health', '/health', '/api/v1/auth/me', ''])(
    'logs %s at info',
    (url) => {
      expect(isHealthCheckPath(url)).toBe(false);
      expect(requestLogLevel(req(url))).toBe('info');
    },
  );

  it('uses the original URL when a router has rewritten req.url', () => {
    expect(requestLogLevel(req('/ready', '/api/v1/health/ready'))).toBe('debug');
    expect(requestLogLevel(req('/api/v1/health', '/api/v1/auth/me'))).toBe('info');
  });
});
