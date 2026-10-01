/** A liveness session at the provider. Only `sdkToken` and `expiresAt` reach the app. */
export interface FaceSession {
  /** The provider's id. Stored server-side only; never returned by our API. */
  providerSessionId: string;
  /** What the app's capture SDK needs to start this session. Opaque to the app. */
  sdkToken: string;
  /** When the provider stops accepting this session. */
  expiresAt: Date;
}

/**
 * pending: the capture is not finished yet · succeeded: a result exists ·
 * failed: the provider could not run the check (nothing to decide on) ·
 * expired: the session timed out at the provider.
 */
export type FaceSessionStatus = 'pending' | 'succeeded' | 'failed' | 'expired';

export interface FaceSessionResult {
  status: FaceSessionStatus;
  /** 0–100, only when succeeded. */
  livenessScore: number | null;
  /** The provider's reference frame (JPEG or PNG). Never logged, never returned by our API. */
  referenceImage?: Buffer;
  /** Faces found in the reference frame. */
  faceCount: number;
  /** The reference frame is too dark, blurred or small to rely on. */
  qualityIssues?: boolean;
}

export interface FaceComparison {
  /** 0–100; 0 when either image has no face. */
  similarity: number;
}

/**
 * A provider call failed or timed out. The message is ours and holds no
 * provider payload; callers log the class only.
 */
export class FaceProviderError extends Error {
  override readonly name = 'FaceProviderError';
}

/**
 * Port for live verification (guide §4.4, M11): AWS Rekognition Face
 * Liveness in production, a fake in development and tests. Stateless: no
 * face collections and no stored face templates; every comparison sends
 * both images. Every method throws FaceProviderError on failure.
 */
export abstract class FaceProvider {
  /** Provider name stored on face_verifications.provider (VARCHAR(30)). */
  abstract readonly name: string;

  /** `userId` is ours; implementations never send it (or anything about the user) to the provider. */
  abstract createSession(userId: string): Promise<FaceSession>;

  abstract getSessionResult(providerSessionId: string): Promise<FaceSessionResult>;

  /** Used by M12 photo matching against the approved selfie. */
  abstract compareFaces(a: Buffer, b: Buffer): Promise<FaceComparison>;
}
