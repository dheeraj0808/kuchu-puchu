import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { ClientPlatform, RequestContext } from '../utils/request-context';

const MAX_UA_LENGTH = 512;
const APP_VERSION_PATTERN = /^[0-9A-Za-z.+-]{1,20}$/;
/** Same rule as VerifyOtpDto.deviceId. */
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const PLATFORMS: readonly ClientPlatform[] = ['android', 'ios'];

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : undefined;
}

function matching(value: string | undefined, pattern: RegExp): string | undefined {
  return value !== undefined && pattern.test(value) ? value : undefined;
}

export function extractRequestContext(req: Request): RequestContext {
  const ua = req.headers['user-agent'];
  const platform = header(req, 'x-platform')?.toLowerCase();
  return {
    // req.ip honours the `trust proxy` setting configured in app.setup.ts.
    ipAddress: req.ip ?? null,
    userAgent: typeof ua === 'string' ? ua.slice(0, MAX_UA_LENGTH) : null,
    appVersion: matching(header(req, 'x-app-version'), APP_VERSION_PATTERN),
    platform: PLATFORMS.find((p) => p === platform),
    deviceId: matching(header(req, 'x-device-id'), DEVICE_ID_PATTERN),
  };
}

/** Injects `{ ipAddress, userAgent, appVersion, platform, deviceId }` of the current request. */
export const ClientContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext =>
    extractRequestContext(ctx.switchToHttp().getRequest<Request>()),
);
