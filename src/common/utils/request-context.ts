export type ClientPlatform = 'android' | 'ios';

/**
 * Who is calling, from the connection and the client headers (guide §4.1:
 * X-App-Version, X-Platform, X-Device-Id on every call). Header values are
 * optional and never trusted for authorization; missing or malformed values
 * are undefined.
 */
export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
  appVersion?: string;
  platform?: ClientPlatform;
  deviceId?: string;
}
