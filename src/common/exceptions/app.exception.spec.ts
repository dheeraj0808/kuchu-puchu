import { AppException, ERROR_DEFINITIONS, ErrorCode } from './app.exception';

describe('AppException', () => {
  it('takes status and message from the central map', () => {
    const e = new AppException(ErrorCode.ProfileAlreadyExists);
    expect(e.getStatus()).toBe(409);
    expect(e.message).toBe('Profile already exists');
    expect(e.code).toBe('PROFILE_ALREADY_EXISTS');
  });

  it('carries details', () => {
    const e = new AppException(ErrorCode.OtpCooldown, { retryAfterSeconds: 30 });
    expect(e.getStatus()).toBe(429);
    expect(e.details).toEqual({ retryAfterSeconds: 30 });
  });

  it('defines every code with an HTTP status and a message', () => {
    for (const code of Object.values(ErrorCode)) {
      const def = ERROR_DEFINITIONS[code];
      expect(def.httpStatus).toBeGreaterThanOrEqual(400);
      expect(def.defaultMessage.length).toBeGreaterThan(0);
    }
  });
});
