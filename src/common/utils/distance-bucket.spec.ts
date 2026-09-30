import { DistanceBucket, distanceBucket } from './distance-bucket';

describe('distanceBucket', () => {
  it('has exactly the M09 buckets, in order', () => {
    expect(Object.values(DistanceBucket)).toEqual([
      'LT_2_KM',
      'LT_5_KM',
      'LT_10_KM',
      'LT_25_KM',
      'LT_50_KM',
      'LT_100_KM',
      'GT_100_KM',
    ]);
  });

  it.each([
    [0, 'LT_2_KM'],
    [1.99, 'LT_2_KM'],
    [2, 'LT_5_KM'],
    [4.999, 'LT_5_KM'],
    [5, 'LT_10_KM'],
    [9.9, 'LT_10_KM'],
    [10, 'LT_25_KM'],
    [24.9, 'LT_25_KM'],
    [25, 'LT_50_KM'],
    [49.9, 'LT_50_KM'],
    [50, 'LT_100_KM'],
    [99.99, 'LT_100_KM'],
    [100, 'GT_100_KM'],
    [12_000, 'GT_100_KM'],
  ])('%p km → %s', (km, bucket) => {
    expect(distanceBucket(km)).toBe(bucket);
  });

  it.each([-0.1, Number.NaN, Number.POSITIVE_INFINITY])('rejects %p', (km) => {
    expect(() => distanceBucket(km)).toThrow(RangeError);
  });
});
