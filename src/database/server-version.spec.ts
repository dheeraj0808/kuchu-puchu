import { assertSupportedServer } from './server-version';

describe('assertSupportedServer', () => {
  it.each(['8.4.0', '8.4.11', '8.4.3-commercial', '9.1.0', '9.6.0'])('accepts MySQL %s', (v) => {
    expect(() => assertSupportedServer(v)).not.toThrow();
  });

  it.each(['10.4.28-MariaDB', '11.4.2-MariaDB-log', '5.5.5-10.6.12-MariaDB'])('refuses MariaDB %s', (v) => {
    expect(() => assertSupportedServer(v)).toThrow(/MariaDB/);
  });

  it.each(['8.0.36', '8.3.0', '5.7.44'])('refuses MySQL older than 8.4 (%s)', (v) => {
    expect(() => assertSupportedServer(v)).toThrow(/8\.4 LTS or newer/);
  });

  it('refuses a version it cannot parse', () => {
    expect(() => assertSupportedServer('unknown')).toThrow(/Unrecognised/);
  });
});
