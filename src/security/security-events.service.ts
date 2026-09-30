import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import type { Transaction } from 'sequelize';

import type { IdentifierType } from '../auth/models/otp-verification.model';
import { hmacSha256 } from '../common/utils/hmac';
import type { RequestContext } from '../common/utils/request-context';
import type { SecurityConfig } from '../config/security.config';
import { SecurityEvent, SecurityEventType } from './models/security-event.model';

export interface RecordSecurityEventInput {
  eventType: SecurityEventType;
  userId?: string | null;
  /** Who did it (moderator/admin), when not the subject. */
  actorUserId?: string | null;
  context?: RequestContext;
  metadata?: Record<string, unknown>;
  /** Writes inside the caller's transaction; without it the event is written on its own. */
  transaction?: Transaction;
}

/** Guide M05: identifiers go in only as a 12-char HMAC prefix. */
export const IDENTIFIER_HASH_PREFIX_LENGTH = 12;

/**
 * Metadata keys that are never stored, at any depth: the owner's list in any
 * case with `_`/`-` ignored, plus keys starting or ending with token,
 * password, email, phone or otp (accessToken, phoneNumber, newEmail,
 * otpCode). Hash prefixes and the identifier type are explicitly allowed.
 */
const FORBIDDEN_KEYS = new Set(['phone', 'email', 'identifier', 'otp', 'token', 'password', 'lat', 'lng', 'latitude', 'longitude']);
const FORBIDDEN_PARTS = ['token', 'password', 'email', 'phone', 'otp'];
const ALLOWED_KEYS = new Set(['identifierhashprefix', 'identifierhashprefixes', 'identifiertype']);

function isForbiddenKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[_-]/g, '');
  if (ALLOWED_KEYS.has(k)) return false;
  return FORBIDDEN_KEYS.has(k) || FORBIDDEN_PARTS.some((part) => k.startsWith(part) || k.endsWith(part));
}

/** MySQL errors after which InnoDB has rolled back the caller's whole transaction. */
function abortsTransaction(err: unknown): boolean {
  const e = err as { name?: string; parent?: { errno?: number; code?: string } } | null;
  const errno = e?.parent?.errno;
  return errno === 1213 || e?.name === 'SequelizeConnectionError' || /^Sequelize.*Connection/.test(e?.name ?? '');
}

const USER_AGENT_MAX = 255;
const MAX_DEPTH = 8;

/**
 * Returns a copy without forbidden keys (nested objects and arrays included)
 * and the dotted paths of what was dropped. Deeper than MAX_DEPTH is dropped too.
 */
export function stripPii(value: unknown, path = '', dropped: string[] = [], depth = 0): unknown {
  if (Array.isArray(value)) return value.map((v, i) => stripPii(v, `${path}[${i}]`, dropped, depth + 1));
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  if (depth >= MAX_DEPTH) {
    dropped.push(path || '(root)');
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const keyPath = path ? `${path}.${key}` : key;
    if (isForbiddenKey(key)) {
      dropped.push(keyPath);
      continue;
    }
    out[key] = stripPii(v, keyPath, dropped, depth + 1);
  }
  return out;
}

@Injectable()
export class SecurityEventsService {
  private readonly logger = new Logger(SecurityEventsService.name);

  constructor(
    @InjectModel(SecurityEvent)
    private readonly securityEventModel: typeof SecurityEvent,
    private readonly config: ConfigService,
  ) {}

  /**
   * The only way an identifier goes into audit metadata: a 12-char prefix of
   * HMAC-SHA256(secret, "<type>:<normalised value>"), the same keyed hash the
   * OTP rows use, so events can be correlated without storing the value.
   */
  hashIdentifier(type: IdentifierType, normalizedIdentifier: string): string {
    const secret = this.config.getOrThrow<SecurityConfig>('security').identifierHashSecret;
    return hmacSha256(secret, `${type}:${normalizedIdentifier}`).slice(0, IDENTIFIER_HASH_PREFIX_LENGTH);
  }

  /**
   * Records an audit event. Never throws into the caller: any failure
   * (DB down, bad input) is logged with the error class only.
   * One exception, inside a caller's transaction: if the insert failed in a
   * way that already rolled that transaction back (deadlock, lost
   * connection), the error is rethrown, so the caller cannot report success
   * for work that was undone.
   */
  async record(input: RecordSecurityEventInput): Promise<void> {
    try {
      const dropped: string[] = [];
      const metadata = input.metadata ? (stripPii(input.metadata, '', dropped) as Record<string, unknown>) : null;
      if (dropped.length > 0) {
        // Key paths only, never the values.
        this.logger.warn({ eventType: input.eventType, droppedKeys: dropped }, 'Dropped PII keys from security event metadata');
      }
      await this.securityEventModel.create(
        {
          eventType: input.eventType,
          userId: input.userId ?? null,
          actorUserId: input.actorUserId ?? null,
          ipAddress: input.context?.ipAddress ?? null,
          userAgent: input.context?.userAgent?.slice(0, USER_AGENT_MAX) ?? null,
          metadata,
        },
        { transaction: input.transaction },
      );
    } catch (err) {
      this.logger.error({ eventType: input?.eventType, err: (err as Error)?.name ?? typeof err }, 'Failed to record security event');
      if (input?.transaction && abortsTransaction(err)) throw err;
    }
  }
}
