import { isIPv4, isIPv6 } from 'node:net';

/**
 * The unit per-IP limits count against. IPv4 addresses (also IPv4-mapped
 * IPv6) as they are; IPv6 collapsed to its /64, because one subscriber
 * usually holds a whole /64 and could otherwise rotate through it. Anything
 * else (empty, malformed) is "unknown", one shared bucket.
 */
export function ipBucket(ip: string | null | undefined): string {
  const value = (ip ?? '').trim();
  if (isIPv4(value)) return value;
  const mapped = /^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped && isIPv6(value) && isIPv4(mapped[1])) return mapped[1];
  if (!isIPv6(value)) return 'unknown';
  // Hex-form IPv4-mapped (::ffff:102:304) is the same IPv4 address.
  const hexMapped = /^(?:0{0,4}:){0,5}:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(value);
  if (hexMapped) {
    const [hi, lo] = [parseInt(hexMapped[1], 16), parseInt(hexMapped[2], 16)];
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  const [head, tail = ''] = value.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = value.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}
