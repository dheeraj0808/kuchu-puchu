import { FaceRejectionReason, FaceVerificationStatus } from './models/face-verification.model';

export interface FaceEvidence {
  /** 0–100 from the provider. */
  livenessScore: number;
  faceCount: number;
  /** Dark, blurred or too small to rely on (provider quality or our own size check). */
  qualityIssues: boolean;
  /** A usable reference frame was returned (needed to approve, review or match photos later). */
  hasImage: boolean;
}

export interface FaceThresholds {
  autoApproveScore: number;
  reviewScore: number;
}

export type FaceDecision =
  | { status: FaceVerificationStatus.Approved }
  | { status: FaceVerificationStatus.PendingReview }
  | { status: FaceVerificationStatus.Rejected; reason: FaceRejectionReason };

/**
 * Guide M11 decision rules. Only server-side provider evidence goes in:
 * - no face (or no frame) → rejected, face_not_visible;
 * - score < review → rejected: poor_quality when the frame had quality issues, else not_live;
 * - more than one face, quality issues, or review ≤ score < auto-approve → pending_review;
 * - score ≥ auto-approve and exactly one clear face → approved.
 */
export function decideFace(e: FaceEvidence, t: FaceThresholds): FaceDecision {
  if (e.faceCount === 0 || !e.hasImage) return { status: FaceVerificationStatus.Rejected, reason: FaceRejectionReason.FaceNotVisible };
  if (e.livenessScore < t.reviewScore) {
    return { status: FaceVerificationStatus.Rejected, reason: e.qualityIssues ? FaceRejectionReason.PoorQuality : FaceRejectionReason.NotLive };
  }
  if (e.faceCount > 1 || e.qualityIssues || e.livenessScore < t.autoApproveScore) return { status: FaceVerificationStatus.PendingReview };
  return { status: FaceVerificationStatus.Approved };
}
