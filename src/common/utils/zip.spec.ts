import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildZip, readZip } from './zip';

describe('zip', () => {
  const entries = [
    { name: 'account.json', data: Buffer.from(JSON.stringify({ id: 'u1', note: 'नमस्ते' })) },
    { name: 'empty.json', data: Buffer.from('') },
    { name: 'big.json', data: Buffer.from('x'.repeat(100_000)) },
  ];

  it('round-trips every entry (CRC checked)', () => {
    const files = readZip(buildZip(entries));
    expect([...files.keys()]).toEqual(['account.json', 'empty.json', 'big.json']);
    for (const e of entries) expect(files.get(e.name)?.equals(e.data)).toBe(true);
  });

  it('compresses', () => {
    expect(buildZip(entries).length).toBeLessThan(5_000);
  });

  it('rejects unsafe or duplicate names', () => {
    for (const name of ['../x', '/abs', 'a/../b', '']) expect(() => buildZip([{ name, data: Buffer.from('') }])).toThrow('Invalid ZIP entry name');
    expect(() => buildZip([entries[0], entries[0]])).toThrow('Invalid ZIP entry name');
  });

  const hasUnzip = (() => {
    try {
      execFileSync('unzip', ['-v'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  (hasUnzip ? it : it.skip)('is readable by the system unzip tool', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kp-zip-'));
    const path = join(dir, 'export.zip');
    writeFileSync(path, buildZip(entries));
    execFileSync('unzip', ['-t', path], { stdio: 'pipe' });
    expect(execFileSync('unzip', ['-p', path, 'account.json']).toString()).toBe(entries[0].data.toString());
  });
});
