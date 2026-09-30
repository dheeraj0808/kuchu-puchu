import { randomBytes, randomInt } from 'node:crypto';

/**
 * UUID v7 (RFC 9562): 48-bit Unix time in ms, then random bits. IDs sort by
 * creation time, which keeps inserts into CHAR(36) primary keys index-friendly
 * (guide §4.2). Used for all new rows; existing v4 ids stay as they are.
 *
 * The 12-bit rand_a field is used as a counter within the same millisecond, so
 * ids from one process are strictly increasing even when the clock stalls or
 * steps backwards.
 */
const MAX_SEQ = 0xfff;

let lastMs = -1;
let seq = 0;

export function uuidv7(now: number = Date.now()): string {
  if (now > lastMs) {
    lastMs = now;
    // Random start leaves room for ~2k more ids in this millisecond.
    seq = randomInt(0, 0x800);
  } else if (seq < MAX_SEQ) {
    seq++;
  } else {
    // Counter exhausted (or clock went backwards for long): borrow the next ms.
    lastMs++;
    seq = randomInt(0, 0x800);
  }

  const bytes = randomBytes(16);
  let ms = lastMs;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = 0x70 | (seq >> 8);
  bytes[7] = seq & 0xff;
  bytes[8] = 0x80 | (bytes[8] & 0x3f);

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The creation time encoded in a v7 id. */
export function uuidv7Timestamp(id: string): Date {
  return new Date(Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16));
}
