import 'reflect-metadata';

import { JwtService } from '@nestjs/jwt';

import { createTestConfig, TEST_JWT_CONFIG } from '../testing/test-config';
import { TokenService } from './token.service';

describe('TokenService', () => {
  const jwt = new JwtService();
  const tokens = new TokenService(jwt, createTestConfig());
  const payload = {
    sub: '6f1c2e0a-8a1b-4c2d-9e3f-0a1b2c3d4e5f',
    sid: '7a1c2e0a-8a1b-4c2d-9e3f-0a1b2c3d4e5f',
  };

  it('signs HS256 access tokens with iss/aud/exp', async () => {
    const { token, expiresInSeconds } = await tokens.signAccessToken(payload);
    expect(expiresInSeconds).toBe(900);
    const decoded = await jwt.verifyAsync<Record<string, unknown>>(token, {
      secret: TEST_JWT_CONFIG.accessSecret,
      issuer: TEST_JWT_CONFIG.issuer,
      audience: TEST_JWT_CONFIG.audience,
      algorithms: ['HS256'],
    });
    expect(decoded).toMatchObject(payload);
    // Guide M06: claims {sub, sid, iss, aud} only; the role is read from the database.
    expect(Object.keys(decoded).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sid', 'sub']);
    expect((decoded.exp as number) - (decoded.iat as number)).toBe(900);
  });

  it('rejects tokens signed with the wrong secret', async () => {
    const forged = await jwt.signAsync(payload, {
      secret: 'wrong-secret-wrong-secret-wrong-secret-1234',
      issuer: TEST_JWT_CONFIG.issuer,
      audience: TEST_JWT_CONFIG.audience,
    });
    await expect(
      jwt.verifyAsync(forged, { secret: TEST_JWT_CONFIG.accessSecret, algorithms: ['HS256'] }),
    ).rejects.toThrow();
  });

  it('parses refresh tokens strictly', () => {
    const secret = tokens.generateRefreshSecret();
    const t = tokens.buildRefreshToken(payload.sid, secret);
    expect(tokens.parseRefreshToken(t)).toEqual({ sessionId: payload.sid, secret });
    expect(tokens.parseRefreshToken(`${payload.sid}.short`)).toBeNull();
    expect(tokens.parseRefreshToken(`nope.${secret}`)).toBeNull();
    expect(tokens.parseRefreshToken(`${payload.sid}.${secret}!`)).toBeNull();
    expect(tokens.parseRefreshToken('')).toBeNull();
    expect(secret).toHaveLength(64);
    expect(tokens.parseRefreshToken(`${payload.sid}.${secret}x`)).toBeNull();
  });

  it('refresh hash is keyed and not the secret', () => {
    const secret = tokens.generateRefreshSecret();
    const h = tokens.hashRefreshSecret(secret);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(secret);
    expect(tokens.slidingMs).toBe(30 * 86_400_000);
    expect(tokens.maxLifetimeMs).toBe(90 * 86_400_000);
  });
});
