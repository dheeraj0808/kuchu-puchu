import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  /** Plain relative name such as account.json. */
  name: string;
  data: Buffer;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

/** MS-DOS date/time for the local and central headers. */
function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    date: ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

/**
 * A minimal ZIP writer (deflate, no ZIP64, no encryption) for small archives
 * built in memory such as data exports. Node's zlib does the compression and
 * the CRC, so no archive package is needed.
 */
export function buildZip(entries: ZipEntry[], modified: Date = new Date()): Buffer {
  const { time, date } = dosDateTime(modified);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!NAME.test(entry.name) || entry.name.includes('..') || seen.has(entry.name)) throw new Error('Invalid ZIP entry name');
    seen.add(entry.name);
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** Reads an archive written by buildZip (tests and tools); checks every CRC. */
export function readZip(zip: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const endAt = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error('Not a ZIP archive');
  const count = zip.readUInt16LE(endAt + 10);
  let p = zip.readUInt32LE(endAt + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad central directory');
    const crc = zip.readUInt32LE(p + 16);
    const size = zip.readUInt32LE(p + 20);
    const nameLength = zip.readUInt16LE(p + 28);
    const extra = zip.readUInt16LE(p + 30);
    const comment = zip.readUInt16LE(p + 32);
    const localAt = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLength).toString('utf8');
    const dataAt = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
    const data = inflateRawSync(zip.subarray(dataAt, dataAt + size));
    if (crc32(data) !== crc) throw new Error(`CRC mismatch in ${name}`);
    out.set(name, data);
    p += 46 + nameLength + extra + comment;
  }
  return out;
}
