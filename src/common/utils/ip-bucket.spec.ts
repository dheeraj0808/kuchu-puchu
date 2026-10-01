import { ipBucket } from './ip-bucket';

describe('ipBucket', () => {
  it.each([
    ['203.0.113.9', '203.0.113.9'],
    ['::ffff:203.0.113.9', '203.0.113.9'],
    ['0:0:0:0:0:ffff:203.0.113.9', '203.0.113.9'],
    ['::ffff:cb00:7109', '203.0.113.9'],
    ['::FFFF:CB00:7109', '203.0.113.9'],
    ['2001:db8:abcd:12:1:2:3:4', '2001:db8:abcd:12::/64'],
    ['2001:0db8:abcd:0012:ffff::1', '2001:db8:abcd:12::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['', 'unknown'],
    [null, 'unknown'],
    ['not-an-ip', 'unknown'],
  ])('%p → %p', (ip, bucket) => {
    expect(ipBucket(ip)).toBe(bucket);
  });

  it('every address of one /64 shares a bucket', () => {
    expect(ipBucket('2001:db8:1:2:aaaa::1')).toBe(ipBucket('2001:db8:1:2:ffff:ffff:ffff:ffff'));
    expect(ipBucket('2001:db8:1:2::1')).not.toBe(ipBucket('2001:db8:1:3::1'));
  });
});
