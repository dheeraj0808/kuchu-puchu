import sharp from 'sharp';

/** Same limits as M12 photos: at most 50 MP decoded, longest side 1280 px, WebP. */
export const SELFIE_MAX_INPUT_PIXELS = 50_000_000;
export const SELFIE_MAX_SIDE = 1280;
/** A reference frame smaller than this on either side is a quality issue (review, not approval). */
export const SELFIE_MIN_SIDE = 200;
const WEBP_QUALITY = 85;

export interface SelfieImage {
  webp: Buffer;
  width: number;
  height: number;
  /** Below SELFIE_MIN_SIDE. */
  tooSmall: boolean;
}

/** The image could not be read as a JPEG, PNG or WebP. Holds no image data. */
export class SelfieImageError extends Error {
  override readonly name = 'SelfieImageError';
}

function isJpegPngOrWebp(b: Buffer): boolean {
  if (b.length < 12) return false;
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
  return jpeg || png || webp;
}

/**
 * Re-encodes the provider's reference frame for storage (guide S6, M12
 * rules): magic bytes checked, pixel count capped, auto-rotated from EXIF,
 * resized to fit 1280 px, WebP. sharp writes no metadata unless asked, so
 * EXIF, GPS, XMP, IPTC and ICC are all dropped.
 */
export async function toSelfieWebp(input: Buffer): Promise<SelfieImage> {
  if (!isJpegPngOrWebp(input)) throw new SelfieImageError('Reference frame is not a JPEG, PNG or WebP image');
  try {
    const { data, info } = await sharp(input, { limitInputPixels: SELFIE_MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate()
      .resize({ width: SELFIE_MAX_SIDE, height: SELFIE_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { webp: data, width: info.width, height: info.height, tooSmall: Math.min(info.width, info.height) < SELFIE_MIN_SIDE };
  } catch {
    throw new SelfieImageError('Reference frame could not be decoded');
  }
}
