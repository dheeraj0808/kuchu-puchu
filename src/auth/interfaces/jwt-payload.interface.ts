/** Access-token claims (guide M06): {sub, sid, iss, aud} plus iat/exp. No role. */
export interface JwtPayload {
  sub: string;
  sid: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
}
