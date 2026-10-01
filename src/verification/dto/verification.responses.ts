import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { FaceRejectionReason } from '../models/face-verification.model';

/** What the app shows on the selfie step. "required" also covers a session that is still open or expired. */
export enum FaceStatus {
  Required = 'required',
  PendingReview = 'pending_review',
  Approved = 'approved',
  Rejected = 'rejected',
}

/** The outcome of one completion call. */
export enum FaceAttemptOutcome {
  Approved = 'approved',
  PendingReview = 'pending_review',
  Rejected = 'rejected',
  /** Not completed in time, or replaced by a newer session: start a new one (no attempt used). */
  Expired = 'expired',
  /** The capture is not finished at the provider yet: call complete again (no attempt used). */
  Processing = 'processing',
}

const ATTEMPTS_LEFT = 'Selfie attempts the user can still make now (rolling 24 h and lifetime limits)';
const RESET_AT = 'When the next attempt frees up, if none is left today; null otherwise (also when the lifetime limit is used up: support only)';

export class FaceVerificationResponse {
  @ApiProperty({ enum: FaceStatus }) status: FaceStatus;
  @ApiProperty({ description: ATTEMPTS_LEFT, minimum: 0 }) attemptsLeft: number;
  @ApiProperty({ description: RESET_AT, format: 'date-time', nullable: true, type: String }) attemptsResetAt: string | null;
  @ApiPropertyOptional({ enum: FaceRejectionReason, description: 'Only when rejected: what the user can do differently' })
  rejectionReason?: FaceRejectionReason;
  @ApiPropertyOptional({ format: 'date-time', description: 'Only once decided' }) decidedAt?: string;
}

/** Keyed by kind, so ID verification (M23) can add `id` next to `face`. */
export class VerificationStatusResponse {
  @ApiProperty({ type: FaceVerificationResponse }) face: FaceVerificationResponse;
}

export class FaceSessionResponse {
  @ApiProperty({ format: 'uuid', description: 'Our id for this attempt; send it to POST /verification/face/complete' }) sessionId: string;
  @ApiProperty({ description: "Opaque handle for the provider's capture SDK. Never send it back to this API." }) sdkToken: string;
  @ApiProperty({ format: 'date-time', description: 'Complete the capture before this' }) expiresAt: string;
}

export class FaceCompleteResponse {
  @ApiProperty({ format: 'uuid' }) sessionId: string;
  @ApiProperty({ enum: FaceAttemptOutcome }) status: FaceAttemptOutcome;
  @ApiPropertyOptional({ enum: FaceRejectionReason, description: 'Only when rejected' }) rejectionReason?: FaceRejectionReason;
  @ApiPropertyOptional({ format: 'date-time', description: 'Only once decided' }) decidedAt?: string;
  @ApiProperty({ description: ATTEMPTS_LEFT, minimum: 0 }) attemptsLeft: number;
  @ApiProperty({ description: RESET_AT, format: 'date-time', nullable: true, type: String }) attemptsResetAt: string | null;
}
