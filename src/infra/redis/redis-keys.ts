/** Every key this app writes starts with this, so tools and tests can scope to it. */
export const REDIS_KEY_PREFIX = 'kp';

const PART_PATTERN = /^[^\s:]+$/;

/**
 * Builds a key in the guide's `kp:<area>:<id>` format. Extra parts are
 * appended with ':' (e.g. redisKey('throttle', 'default', ip)).
 * Area and parts must be non-empty and contain no ':' or whitespace, except the
 * last part, which may contain ':' (IPv6 addresses, composite ids).
 */
export function redisKey(area: string, ...parts: string[]): string {
  if (!PART_PATTERN.test(area)) {
    throw new Error(`Invalid Redis key area "${area}"`);
  }
  if (parts.length === 0) {
    throw new Error('A Redis key needs at least one id part');
  }
  parts.forEach((part, i) => {
    const isLast = i === parts.length - 1;
    const valid = isLast ? part.length > 0 && !/\s/.test(part) : PART_PATTERN.test(part);
    if (!valid) throw new Error(`Invalid Redis key part "${part}"`);
  });
  return [REDIS_KEY_PREFIX, area, ...parts].join(':');
}
