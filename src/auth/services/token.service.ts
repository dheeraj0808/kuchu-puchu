import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { JwtConfig } from '../../config/jwt.config';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';
import { generateTokenSecret, hmacSha256, parseDuration } from '../utils/crypto.util';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_REGEX = /^[A-Za-z0-9_-]{43,128}$/;

export interface SignedAccessToken {
  token: string;
  expiresInSeconds: number;
}

export interface ParsedRefreshToken {
  sessionId: string;
  secret: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private get cfg(): JwtConfig {
    return this.config.getOrThrow<JwtConfig>('jwt');
  }

  get accessTtlSeconds(): number {
    return parseDuration(this.cfg.accessExpiresIn);
  }

  get refreshTtlSeconds(): number {
    return parseDuration(this.cfg.refreshExpiresIn);
  }

  async signAccessToken(payload: Pick<JwtPayload, 'sub' | 'sid' | 'role'>): Promise<SignedAccessToken> {
    const cfg = this.cfg;
    const expiresInSeconds = parseDuration(cfg.accessExpiresIn);
    const token = await this.jwt.signAsync(
      { sub: payload.sub, sid: payload.sid, role: payload.role },
      {
        secret: cfg.accessSecret,
        expiresIn: expiresInSeconds,
        issuer: cfg.issuer,
        audience: cfg.audience,
        algorithm: 'HS256',
      },
    );
    return { token, expiresInSeconds };
  }

  generateRefreshSecret(): string {
    return generateTokenSecret();
  }

  buildRefreshToken(sessionId: string, secret: string): string {
    return `${sessionId}.${secret}`;
  }

  hashRefreshSecret(secret: string): string {
    return hmacSha256(this.cfg.refreshSecret, secret);
  }

  parseRefreshToken(token: string): ParsedRefreshToken | null {
    if (typeof token !== 'string' || token.length > 512) return null;
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const sessionId = token.slice(0, dot);
    const secret = token.slice(dot + 1);
    if (!UUID_REGEX.test(sessionId) || !SECRET_REGEX.test(secret)) return null;
    return { sessionId: sessionId.toLowerCase(), secret };
  }
}
