import { registerAs } from '@nestjs/config';

import { FaceProviderName, type FakeFaceOutcome, getValidatedEnv } from './env.validation';

export interface VerificationConfig {
  /** Liveness provider adapter (M11). "fake" outside production when FACE_PROVIDER is unset. */
  faceProvider: FaceProviderName;
  /** Liveness score at or above which one clear face is approved. */
  autoApproveScore: number;
  /** Below this the attempt is rejected; from here up to autoApproveScore it goes to review. */
  reviewScore: number;
  /** A session not completed within this time is expired by the hourly job. */
  sessionTtlSeconds: number;
  /** Per provider call. */
  providerTimeoutMs: number;
  /** AWS region of the Rekognition client (AWS_REGION). */
  awsRegion: string;
  /** The fake provider's starting outcome. */
  fakeOutcome: FakeFaceOutcome;
}

export const verificationConfig = registerAs('verification', (): VerificationConfig => {
  const env = getValidatedEnv();
  return {
    faceProvider: env.FACE_PROVIDER ?? FaceProviderName.Fake,
    autoApproveScore: env.FACE_AUTO_APPROVE_SCORE,
    reviewScore: env.FACE_REVIEW_SCORE,
    sessionTtlSeconds: env.FACE_SESSION_TTL_SECONDS,
    providerTimeoutMs: env.FACE_PROVIDER_TIMEOUT_MS,
    awsRegion: env.AWS_REGION ?? '',
    fakeOutcome: env.FACE_FAKE_OUTCOME,
  };
});
