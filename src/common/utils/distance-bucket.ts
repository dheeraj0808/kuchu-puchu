/**
 * Distance buckets from guide M09. Other users only ever see a bucket, never
 * coordinates or an exact distance (guide S5).
 */
export enum DistanceBucket {
  Lt2Km = 'LT_2_KM',
  Lt5Km = 'LT_5_KM',
  Lt10Km = 'LT_10_KM',
  Lt25Km = 'LT_25_KM',
  Lt50Km = 'LT_50_KM',
  Lt100Km = 'LT_100_KM',
  Gt100Km = 'GT_100_KM',
}

const UPPER_BOUNDS: ReadonlyArray<[number, DistanceBucket]> = [
  [2, DistanceBucket.Lt2Km],
  [5, DistanceBucket.Lt5Km],
  [10, DistanceBucket.Lt10Km],
  [25, DistanceBucket.Lt25Km],
  [50, DistanceBucket.Lt50Km],
  [100, DistanceBucket.Lt100Km],
];

/** Maps a distance in km to its bucket. "Less than" is strict: exactly 5 km is LT_10_KM. */
export function distanceBucket(km: number): DistanceBucket {
  if (!Number.isFinite(km) || km < 0) {
    throw new RangeError('Distance must be a finite, non-negative number of km');
  }
  for (const [limit, bucket] of UPPER_BOUNDS) {
    if (km < limit) return bucket;
  }
  return DistanceBucket.Gt100Km;
}
