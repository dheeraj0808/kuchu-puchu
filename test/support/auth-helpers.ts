import { randomUUID } from 'node:crypto';

import { getConnectionToken } from '@nestjs/sequelize';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Sequelize } from 'sequelize-typescript';
import request from 'supertest';

import { type DeviceInfo, SessionService } from '../../src/auth/services/session.service';
import { TokenService } from '../../src/auth/services/token.service';
import { fakeEmail, fakeSms } from './test-app';

export const ctx = { ipAddress: '203.0.113.9', userAgent: 'jest' };

export function newDevice(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
  return { deviceId: `dev-${randomUUID()}`, deviceName: 'Test phone', platform: 'android', appVersion: '1.0.0', ...overrides };
}

/** A random valid Indian mobile number, e.g. +9198xxxxxxxx. */
export const indianMobile = (): string => `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

export const uniqueEmail = (tag = 'user'): string => `${tag}.${randomUUID().slice(0, 8)}@example.com`;

// Random start per run: the local test DB keeps otp_verifications rows, so a re-run must not reuse last run's IPs.
let ipCounter = Math.floor(Math.random() * 60_000);
/** A fresh client IP per call (from 198.18.0.0/15), so per-IP limits never couple tests or runs. */
export const freshIp = (): string => {
  ipCounter = (ipCounter + 1) % 65_000;
  return `198.${18 + (ipCounter % 2)}.${Math.floor(ipCounter / 500) % 250}.${(Math.floor(ipCounter / 2) % 250) + 1}`;
};

/** A random number outside the default SMS allowlist (+1 415 555 xxxx). */
export const usMobile = (): string => `+1415555${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`;

export interface SignedIn {
  userId: string;
  sessionId: string;
  accessToken: string;
  refreshToken: string;
}

/** Opens a session directly (no OTP), for tests that need several sessions quickly. */
export async function openSession(app: NestExpressApplication, userId: string, device: DeviceInfo = newDevice()): Promise<SignedIn> {
  const sequelize = app.get<Sequelize>(getConnectionToken());
  const { session, refreshToken } = await sequelize.transaction((transaction) =>
    app.get(SessionService).create(userId, device, ctx, transaction),
  );
  const { token } = await app.get(TokenService).signAccessToken({ sub: userId, sid: session.id });
  return { userId, sessionId: session.id, accessToken: token, refreshToken };
}

/** The code most recently sent to an identifier through the fake SMS / email provider. */
export function lastCode(app: NestExpressApplication, identifier: string): string {
  const code = identifier.includes('@')
    ? fakeEmail(app).lastTo(identifier)?.text.match(/\b\d{6}\b/)?.[0]
    : fakeSms(app).lastCodeFor(identifier);
  if (!code) throw new Error('no code was sent to that identifier');
  return code;
}

/** Requests a code and verifies it through the real API. */
export async function login(
  app: NestExpressApplication,
  identifier: string,
  options: { ip?: string; device?: DeviceInfo } = {},
): Promise<SignedIn & { body: Record<string, unknown> }> {
  const server = app.getHttpServer();
  const ip = options.ip ?? freshIp();
  const channel = identifier.includes('@') ? 'email' : 'sms';
  await request(server).post('/api/v1/auth/otp/request').set('X-Forwarded-For', ip).send({ channel, identifier }).expect(200);
  const res = await request(server)
    .post('/api/v1/auth/otp/verify')
    .set('X-Forwarded-For', ip)
    .send({ channel, identifier, otp: lastCode(app, identifier), ...(options.device ?? newDevice()) })
    .expect(200);
  const body = res.body.data as Record<string, unknown> & { accessToken: string; refreshToken: string; user: { id: string } };
  return {
    userId: body.user.id,
    sessionId: body.refreshToken.split('.')[0],
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    body,
  };
}
