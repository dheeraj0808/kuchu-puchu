import { of } from 'rxjs';

import { LastActiveInterceptor } from './last-active.interceptor';

function context(path: string, user?: { userId: string }) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ path, url: path, user }) }),
  } as never;
}

describe('LastActiveInterceptor', () => {
  const touchLastActive = jest.fn().mockResolvedValue(true);
  const interceptor = new LastActiveInterceptor({ touchLastActive } as never);
  const next = { handle: () => of('ok') };

  beforeEach(() => touchLastActive.mockClear());

  it('touches for an authenticated request, without waiting for it', () => {
    touchLastActive.mockReturnValueOnce(new Promise(() => undefined));
    interceptor.intercept(context('/api/v1/auth/me', { userId: 'u1' }), next).subscribe();
    expect(touchLastActive).toHaveBeenCalledWith('u1');
  });

  it.each(['/api/v1/health', '/api/v1/health/ready'])('never for %s, even with a user', (path) => {
    interceptor.intercept(context(path, { userId: 'u1' }), next).subscribe();
    expect(touchLastActive).not.toHaveBeenCalled();
  });

  it('never for an unauthenticated request', () => {
    interceptor.intercept(context('/api/v1/interests'), next).subscribe();
    expect(touchLastActive).not.toHaveBeenCalled();
  });
});
