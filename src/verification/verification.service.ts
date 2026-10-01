import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import type { RequestContext } from '../common/utils/request-context';
import type { VerificationConfig } from '../config/verification.config';
import { OutboxService } from '../events/outbox.service';
import { errorClassOf } from '../infra/alerts/alert.provider';
import { FaceProvider, type FaceSessionResult } from '../infra/face/face.provider';
import { StorageProvider } from '../infra/storage/storage.provider';
import { ProfilesService } from '../profiles/profiles.service';
import { SecurityEventType } from '../security/models/security-event.model';
import { SecurityEventsService } from '../security/security-events.service';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';
import {
  FaceAttemptOutcome,
  type FaceCompleteResponse,
  type FaceSessionResponse,
  FaceStatus,
  type FaceVerificationResponse,
  type VerificationStatusResponse,
} from './dto/verification.responses';
import { decideFace, type FaceDecision } from './face-decision';
import { FaceVerification, FaceVerificationStatus, LIVE_FACE_STATUSES } from './models/face-verification.model';
import { type SelfieImage, SelfieImageError, toSelfieWebp } from './selfie-image';
import { ATTEMPT_WINDOW_MS, scoreBucket, selfieKey } from './verification.constants';

/** Where the attempt quota stands for a user. */
export interface AttemptQuota {
  left: number;
  /** When the next attempt frees up, if none is left today and the lifetime limit is not used up. */
  resetAt: Date | null;
  /** Which limit is used up, if any. */
  exhausted: 'daily' | 'total' | null;
}

const DECIDED = [FaceVerificationStatus.Approved, FaceVerificationStatus.PendingReview, FaceVerificationStatus.Rejected];
const REASON_CODE = /^[a-z0-9_]{1,40}$/;

const isLive = (s: FaceVerificationStatus): boolean => (LIVE_FACE_STATUSES as readonly string[]).includes(s);
const iso = (d: Date | null): string | undefined => d?.toISOString();
const round2 = (n: number): number => Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;

/**
 * Live selfie verification (guide M11). The app only ever sends a consent
 * version and our session id; every score, face count and image comes from
 * the provider, fetched here. Per-user writes lock the users row first, so
 * quota checks, the one-live-session rule and profile creation (which takes
 * the same lock through its creation hook) are serialised per user.
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);
  private readonly cfg: VerificationConfig;

  constructor(
    @InjectModel(FaceVerification) private readonly fvModel: typeof FaceVerification,
    private readonly face: FaceProvider,
    private readonly storage: StorageProvider,
    private readonly outbox: OutboxService,
    private readonly securityEvents: SecurityEventsService,
    private readonly settings: SettingsService,
    private readonly profiles: ProfilesService,
    private readonly users: UsersService,
    @InjectConnection() private readonly sequelize: Sequelize,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<VerificationConfig>('verification');
  }

  /** GET /verification. */
  async getStatus(userId: string): Promise<VerificationStatusResponse> {
    const quota = await this.quota(userId);
    return { face: await this.faceStatus(userId, quota) };
  }

  /** The selfie step of onboarding: an approved attempt exists (requireReverification clears it). */
  async isFaceApproved(userId: string): Promise<boolean> {
    return (await this.fvModel.count({ where: { userId, status: FaceVerificationStatus.Approved } })) > 0;
  }

  /** POST /verification/face/session. */
  async startFaceSession(userId: string, consentVersion: string, ctx?: RequestContext): Promise<FaceSessionResponse> {
    const accepted = await this.settings.get('verification.face.consent_versions');
    if (!accepted.includes(consentVersion)) {
      throw new AppException(ErrorCode.ValidationError, { errors: [{ field: 'consentVersion', message: 'Unknown consent version' }] });
    }
    await this.assertNeedsSelfie(userId);
    const quota = await this.quota(userId);
    if (quota.left === 0) await this.attemptsExceeded(userId, quota, ctx);

    let session;
    try {
      session = await this.face.createSession(userId);
    } catch (err) {
      return this.providerFailed(userId, null, 'session', err, ctx);
    }

    const now = new Date();
    const { row, superseded } = await this.sequelize.transaction(async (tx) => {
      await this.lockUser(userId, tx);
      const live = await this.fvModel.findAll({
        attributes: ['id', 'status'],
        where: { userId, status: { [Op.in]: [...LIVE_FACE_STATUSES] } },
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
      if (live.length > 0) {
        await this.fvModel.update(
          { status: FaceVerificationStatus.Expired },
          { where: { id: { [Op.in]: live.map((r) => r.id) }, status: { [Op.in]: [...LIVE_FACE_STATUSES] } }, transaction: tx },
        );
      }
      const created = await this.fvModel.create(
        {
          userId,
          provider: this.face.name,
          providerSessionId: session.providerSessionId,
          status: FaceVerificationStatus.Created,
          consentVersion,
          consentedAt: now,
        },
        { transaction: tx },
      );
      await this.securityEvents.record({
        eventType: SecurityEventType.FaceSessionCreated,
        userId,
        context: ctx,
        metadata: { verificationId: created.id, consentVersion, superseded: live.length },
        transaction: tx,
      });
      return { row: created, superseded: live.filter((r) => r.status === FaceVerificationStatus.Processing).map((r) => r.id) };
    });
    // A processing row may have an uploaded frame its decision never committed.
    for (const id of superseded) await this.storage.delete('private', selfieKey(id)).catch(() => undefined);

    const ourExpiry = now.getTime() + this.cfg.sessionTtlSeconds * 1000;
    return {
      sessionId: row.id,
      sdkToken: session.sdkToken,
      expiresAt: new Date(Math.min(ourExpiry, session.expiresAt.getTime())).toISOString(),
    };
  }

  /** POST /verification/face/complete. Idempotent: a decided session returns its decision again. */
  async completeFaceSession(userId: string, sessionId: string, ctx?: RequestContext): Promise<FaceCompleteResponse> {
    // Someone else's id, or no such id: the same 404.
    const row = await this.fvModel.findOne({ where: { id: sessionId, userId } });
    if (!row) throw new AppException(ErrorCode.NotFound);
    if (!isLive(row.status)) return this.outcome(row, await this.quota(userId));

    const quota = await this.quota(userId);
    if (quota.left === 0) await this.attemptsExceeded(userId, quota, ctx);

    await this.fvModel.update({ status: FaceVerificationStatus.Processing }, { where: { id: row.id, status: FaceVerificationStatus.Created } });

    let result: FaceSessionResult;
    try {
      result = await this.face.getSessionResult(row.providerSessionId);
    } catch (err) {
      return this.providerFailed(userId, row.id, 'result', err, ctx);
    }

    if (result.status === 'pending') return this.outcome({ ...row.get(), status: FaceVerificationStatus.Processing }, quota, FaceAttemptOutcome.Processing);
    if (result.status === 'failed' || result.status === 'expired') {
      if (result.status === 'failed') {
        await this.securityEvents.record({
          eventType: SecurityEventType.FaceProviderFailed,
          userId,
          context: ctx,
          metadata: { verificationId: row.id, stage: 'result', providerStatus: 'failed' },
        });
      }
      await this.fvModel.update(
        { status: FaceVerificationStatus.Expired },
        { where: { id: row.id, status: { [Op.in]: [...LIVE_FACE_STATUSES] } } },
      );
      const current = await this.fvModel.findByPk(row.id);
      return this.outcome(current ?? row, quota);
    }

    let image: SelfieImage | null = null;
    if (result.referenceImage) {
      try {
        image = await toSelfieWebp(result.referenceImage);
      } catch (err) {
        if (!(err instanceof SelfieImageError)) throw err;
        return this.providerFailed(userId, row.id, 'image', err, ctx);
      }
    }
    const score = round2(result.livenessScore ?? 0);
    const decision = decideFace(
      { livenessScore: score, faceCount: result.faceCount, qualityIssues: Boolean(result.qualityIssues) || Boolean(image?.tooSmall), hasImage: image !== null },
      this.cfg,
    );

    // The object goes first, so a decided row never points at a missing selfie.
    const key = selfieKey(row.id);
    if (image) {
      try {
        await this.storage.put({ bucket: 'private', key, body: image.webp, contentType: 'image/webp' });
      } catch (err) {
        return this.providerFailed(userId, row.id, 'storage', err, ctx);
      }
    }

    const decided = await this.sequelize.transaction(async (tx) => {
      await this.lockUser(userId, tx);
      const fresh = await this.fvModel.findOne({ where: { id: row.id, userId }, transaction: tx, lock: tx.LOCK.UPDATE });
      if (!fresh) throw new AppException(ErrorCode.NotFound);
      // Decided by a parallel call, or replaced by a newer session meanwhile: that state stands.
      if (!isLive(fresh.status)) return { row: fresh, now: false };
      const locked = await this.quota(userId, tx);
      if (locked.left === 0) return { row: fresh, now: false, exceeded: locked };
      await this.applyDecision(fresh, decision, score, image ? key : null, tx);
      await this.securityEvents.record({
        eventType: SecurityEventType.FaceDecided,
        userId,
        context: ctx,
        metadata: {
          verificationId: fresh.id,
          decision: decision.status,
          scoreBucket: scoreBucket(score),
          reason: decision.status === FaceVerificationStatus.Rejected ? decision.reason : null,
          faceCount: result.faceCount,
          qualityIssues: Boolean(result.qualityIssues) || Boolean(image?.tooSmall),
        },
        transaction: tx,
      });
      return { row: fresh, now: true };
    });

    if ('exceeded' in decided && decided.exceeded) await this.attemptsExceeded(userId, decided.exceeded, ctx);
    if (!decided.now && image && decided.row.status === FaceVerificationStatus.Expired) {
      await this.storage.delete('private', key).catch(() => undefined);
    }
    return this.outcome(decided.row, await this.quota(userId));
  }

  /**
   * For M15: moderation asks for a new live selfie. Every approved attempt
   * becomes expired (the table has no "required" status; the rows keep their
   * decided_at, so they still count as attempts), profiles.face_verified_at
   * is cleared, and nextStep returns to "selfie". Runs in the caller's
   * transaction. `reason` is a short code such as photo_mismatch.
   */
  async requireReverification(userId: string, reason: string, tx: Transaction): Promise<void> {
    if (!REASON_CODE.test(reason)) throw new Error('requireReverification: reason must be a short code ([a-z0-9_], 1–40 chars)');
    await this.lockUser(userId, tx);
    const [expired] = await this.fvModel.update(
      { status: FaceVerificationStatus.Expired },
      { where: { userId, status: FaceVerificationStatus.Approved }, transaction: tx },
    );
    await this.profiles.setFaceVerifiedAt(userId, null, tx);
    await this.securityEvents.record({
      eventType: SecurityEventType.FaceReverificationRequired,
      userId,
      metadata: { reason, approvalsCleared: expired },
      transaction: tx,
    });
  }

  /**
   * For the profile-creation hook (M09): face_verified_at for a profile
   * created now. Locks the users row first, like every write here.
   */
  async faceVerifiedAtForNewProfile(userId: string, tx: Transaction): Promise<Date | null> {
    await this.lockUser(userId, tx);
    const approved = await this.fvModel.findOne({
      attributes: ['decidedAt'],
      where: { userId, status: FaceVerificationStatus.Approved },
      order: [['decidedAt', 'DESC']],
      transaction: tx,
    });
    return approved?.decidedAt ?? null;
  }

  /** Counted on decided attempts only (decided_at set). */
  async quota(userId: string, transaction?: Transaction): Promise<AttemptQuota> {
    const [perDay, total] = await Promise.all([
      this.settings.get('verification.face.attempts_per_day'),
      this.settings.get('verification.face.attempts_total'),
    ]);
    const decidedEver = await this.fvModel.count({ where: { userId, decidedAt: { [Op.ne]: null } }, transaction });
    const since = new Date(Date.now() - ATTEMPT_WINDOW_MS);
    const recent = await this.fvModel.findAll({
      attributes: ['decidedAt'],
      where: { userId, decidedAt: { [Op.gt]: since } },
      order: [['decidedAt', 'ASC']],
      transaction,
    });
    const totalLeft = total - decidedEver;
    const dailyLeft = perDay - recent.length;
    const left = Math.max(0, Math.min(totalLeft, dailyLeft));
    if (totalLeft <= 0) return { left: 0, resetAt: null, exhausted: 'total' };
    if (dailyLeft <= 0) {
      // The slot frees when enough of the window's attempts age out to drop below the limit.
      const freesWith = recent[recent.length - perDay].decidedAt as Date;
      return { left: 0, resetAt: new Date(freesWith.getTime() + ATTEMPT_WINDOW_MS), exhausted: 'daily' };
    }
    return { left, resetAt: null, exhausted: null };
  }

  private async faceStatus(userId: string, quota: AttemptQuota): Promise<FaceVerificationResponse> {
    const base = { attemptsLeft: quota.left, attemptsResetAt: quota.resetAt?.toISOString() ?? null };
    const approved = await this.fvModel.findOne({
      attributes: ['decidedAt'],
      where: { userId, status: FaceVerificationStatus.Approved },
      order: [['decidedAt', 'DESC']],
    });
    if (approved) return { status: FaceStatus.Approved, ...base, decidedAt: iso(approved.decidedAt) };
    const last = await this.fvModel.findOne({
      attributes: ['status', 'rejectionReason', 'decidedAt'],
      where: { userId, decidedAt: { [Op.ne]: null } },
      order: [['decidedAt', 'DESC']],
    });
    if (last?.status === FaceVerificationStatus.PendingReview) return { status: FaceStatus.PendingReview, ...base, decidedAt: iso(last.decidedAt) };
    if (last?.status === FaceVerificationStatus.Rejected) {
      return { status: FaceStatus.Rejected, ...base, decidedAt: iso(last.decidedAt), ...(last.rejectionReason ? { rejectionReason: last.rejectionReason } : {}) };
    }
    // Nothing decided, or the last approval was withdrawn by moderation.
    return { status: FaceStatus.Required, ...base };
  }

  /** Approved, or a decision is waiting for a moderator: no new session (409). */
  private async assertNeedsSelfie(userId: string): Promise<void> {
    const blocking = await this.fvModel.findOne({
      attributes: ['status'],
      where: { userId, status: { [Op.in]: [FaceVerificationStatus.Approved, FaceVerificationStatus.PendingReview] } },
    });
    if (blocking) throw new AppException(ErrorCode.VerificationStateConflict, { status: blocking.status });
  }

  private async applyDecision(row: FaceVerification, decision: FaceDecision, score: number, key: string | null, tx: Transaction): Promise<void> {
    const now = new Date();
    row.set({
      status: decision.status,
      livenessScore: score,
      selfieKey: key,
      rejectionReason: decision.status === FaceVerificationStatus.Rejected ? decision.reason : null,
      decidedAt: now,
    });
    await row.save({ transaction: tx });
    const payload = { userId: row.userId, verificationId: row.id };
    if (decision.status === FaceVerificationStatus.Approved) {
      // No profile yet: the profile-creation hook copies the approval when it is created.
      await this.profiles.setFaceVerifiedAt(row.userId, now, tx);
      await this.outbox.publish('verification.face.approved', row.id, payload, tx);
    } else if (decision.status === FaceVerificationStatus.Rejected) {
      await this.outbox.publish('verification.face.rejected', row.id, payload, tx);
    }
  }

  private outcome(
    row: Pick<FaceVerification, 'id' | 'status' | 'rejectionReason' | 'decidedAt'>,
    quota: AttemptQuota,
    override?: FaceAttemptOutcome,
  ): FaceCompleteResponse {
    const status =
      override ??
      (DECIDED.includes(row.status)
        ? (row.status as unknown as FaceAttemptOutcome)
        : row.status === FaceVerificationStatus.Expired
          ? FaceAttemptOutcome.Expired
          : FaceAttemptOutcome.Processing);
    return {
      sessionId: row.id,
      status,
      ...(status === FaceAttemptOutcome.Rejected && row.rejectionReason ? { rejectionReason: row.rejectionReason } : {}),
      ...(row.decidedAt && DECIDED.includes(row.status) ? { decidedAt: row.decidedAt.toISOString() } : {}),
      attemptsLeft: quota.left,
      attemptsResetAt: quota.resetAt?.toISOString() ?? null,
    };
  }

  private async attemptsExceeded(userId: string, quota: AttemptQuota, ctx?: RequestContext): Promise<never> {
    await this.securityEvents.record({
      eventType: SecurityEventType.FaceAttemptsExceeded,
      userId,
      context: ctx,
      metadata: { limit: quota.exhausted },
    });
    const links = await this.settings.get('app.support_links');
    const retryAfterSeconds = quota.resetAt ? Math.max(1, Math.ceil((quota.resetAt.getTime() - Date.now()) / 1000)) : null;
    throw new AppException(ErrorCode.VerificationAttemptsExceeded, {
      retryAfterSeconds,
      limit: quota.exhausted,
      support: {
        hint:
          quota.exhausted === 'total'
            ? 'You have used every selfie attempt. Contact support to verify your account.'
            : 'You can try again later. If the selfie keeps failing, contact support.',
        helpCenterUrl: links.helpCenterUrl,
        supportEmail: links.supportEmail,
      },
    });
  }

  /** 503; the attempt is not counted and the row stays as it was (processing after a result call). */
  private async providerFailed(userId: string, verificationId: string | null, stage: string, err: unknown, ctx?: RequestContext): Promise<never> {
    this.logger.warn({ verificationId, stage, err: errorClassOf(err) }, 'Live verification provider step failed');
    await this.securityEvents.record({
      eventType: SecurityEventType.FaceProviderFailed,
      userId,
      context: ctx,
      metadata: { verificationId, stage, err: errorClassOf(err) },
    });
    throw new AppException(ErrorCode.ProviderUnavailable);
  }

  private async lockUser(userId: string, tx: Transaction): Promise<void> {
    if (!(await this.users.findByIdForUpdate(userId, tx))) throw new AppException(ErrorCode.UserNotFound);
  }
}
