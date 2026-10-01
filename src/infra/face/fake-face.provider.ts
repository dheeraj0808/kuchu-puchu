import { randomUUID } from 'node:crypto';

import sharp from 'sharp';

import { FakeFaceOutcome } from '../../config/env.validation';
import { type FaceComparison, FaceProvider, FaceProviderError, type FaceSession, type FaceSessionResult } from './face.provider';

/** Written into the fake reference frame's EXIF, so tests can prove stored selfies carry no metadata. */
export const FAKE_SELFIE_EXIF_MARKER = 'KP-FAKE-SELFIE-EXIF';

/** Kept per instance so a long-running dev server does not grow without bound. */
const KEPT_SESSIONS = 500;

const SCORES: Partial<Record<FakeFaceOutcome, number>> = {
  [FakeFaceOutcome.Approve]: 97.42,
  [FakeFaceOutcome.Review]: 81.5,
  [FakeFaceOutcome.Reject]: 41.25,
  [FakeFaceOutcome.NoFace]: 12,
  [FakeFaceOutcome.MultipleFaces]: 95.1,
  [FakeFaceOutcome.PoorQuality]: 55,
};

let referenceFrame: Promise<Buffer> | undefined;

/** A geotagged, EXIF-tagged JPEG, made once per process. */
export function fakeReferenceFrame(): Promise<Buffer> {
  referenceFrame ??= sharp({ create: { width: 480, height: 640, channels: 3, background: { r: 200, g: 160, b: 140 } } })
    .jpeg()
    .withExif({
      IFD0: { ImageDescription: FAKE_SELFIE_EXIF_MARKER, Make: 'KuchuPuchuFake', Model: 'Selfie' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '19/1 4/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '72/1 52/1 0/1' },
    })
    .toBuffer();
  return referenceFrame;
}

/**
 * Development and test double. Every result follows `outcome` (FACE_FAKE_OUTCOME
 * at start; tests change it per case). Logs nothing. Never used in production
 * (env validation refuses FACE_PROVIDER unset or "fake" there).
 */
export class FakeFaceProvider extends FaceProvider {
  override readonly name = 'fake';
  private readonly sessions = new Map<string, Date>();
  /** Every provider id and token handed out, so tests can prove none reached a log, row or event. */
  readonly issued: Array<{ providerSessionId: string; sdkToken: string }> = [];
  similarity = 95;

  constructor(
    public outcome: FakeFaceOutcome,
    private readonly ttlSeconds: number,
  ) {
    super();
  }

  override async createSession(_userId: string): Promise<FaceSession> {
    if (this.outcome === FakeFaceOutcome.Error) throw new FaceProviderError('Fake liveness provider is failing');
    const providerSessionId = `fake-${randomUUID()}`;
    const sdkToken = `fake-token-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    this.sessions.set(providerSessionId, expiresAt);
    if (this.sessions.size > KEPT_SESSIONS) this.sessions.delete(this.sessions.keys().next().value as string);
    this.issued.push({ providerSessionId, sdkToken });
    if (this.issued.length > KEPT_SESSIONS) this.issued.shift();
    return { providerSessionId, sdkToken, expiresAt };
  }

  override async getSessionResult(providerSessionId: string): Promise<FaceSessionResult> {
    if (this.outcome === FakeFaceOutcome.Error) throw new FaceProviderError('Fake liveness provider is failing');
    const expiresAt = this.sessions.get(providerSessionId);
    if (!expiresAt || this.outcome === FakeFaceOutcome.Expired) return { status: 'expired', livenessScore: null, faceCount: 0 };
    if (this.outcome === FakeFaceOutcome.Pending) return { status: 'pending', livenessScore: null, faceCount: 0 };
    const livenessScore = SCORES[this.outcome] ?? 0;
    switch (this.outcome) {
      case FakeFaceOutcome.NoFace:
        return { status: 'succeeded', livenessScore, faceCount: 0 };
      case FakeFaceOutcome.MultipleFaces:
        return { status: 'succeeded', livenessScore, faceCount: 2, referenceImage: await fakeReferenceFrame() };
      case FakeFaceOutcome.PoorQuality:
        return { status: 'succeeded', livenessScore, faceCount: 1, qualityIssues: true, referenceImage: await fakeReferenceFrame() };
      default:
        return { status: 'succeeded', livenessScore, faceCount: 1, referenceImage: await fakeReferenceFrame() };
    }
  }

  override async compareFaces(_a: Buffer, _b: Buffer): Promise<FaceComparison> {
    if (this.outcome === FakeFaceOutcome.Error) throw new FaceProviderError('Fake liveness provider is failing');
    return { similarity: this.similarity };
  }
}
