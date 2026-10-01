import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type Transaction } from 'sequelize';

import {
  type AccountDeletionHandler,
  AccountDeletionRegistry,
  type AccountExportContributor,
  AccountExportRegistry,
} from '../account/registry/account-registry';
import { OutboxService } from '../events/outbox.service';
import { type ProfileCreationAttrs, type ProfileCreationHook, ProfileCreationHooks } from '../profiles/profile-creation-hooks';
import { FaceVerification, FaceVerificationStatus, LIVE_FACE_STATUSES } from './models/face-verification.model';
import { ANONYMISED_PROVIDER_SESSION_ID } from './verification.constants';
import { VerificationService } from './verification.service';

/**
 * Account deletion: every attempt is anonymised (provider session id and
 * score removed, open sessions expired; status and dates kept for the
 * audit), and the selfie objects are deleted after the commit through
 * verification.face.purge. selfie_key stays set until an object is really
 * gone, so the 15-minute purge job retries any delete that failed.
 */
@Injectable()
export class FaceVerificationDeletionHandler implements AccountDeletionHandler {
  readonly name = 'face_verification';
  readonly order = 40;

  constructor(
    @InjectModel(FaceVerification) private readonly fvModel: typeof FaceVerification,
    private readonly outbox: OutboxService,
  ) {}

  async handle(userId: string, tx: Transaction): Promise<{ attempts: number; selfies: number }> {
    const rows = await this.fvModel.findAll({ attributes: ['id', 'selfieKey'], where: { userId }, transaction: tx, lock: tx.LOCK.UPDATE });
    if (rows.length === 0) return { attempts: 0, selfies: 0 };
    await this.fvModel.update(
      { status: FaceVerificationStatus.Expired },
      { where: { userId, status: { [Op.in]: [...LIVE_FACE_STATUSES] } }, transaction: tx },
    );
    await this.fvModel.update({ providerSessionId: ANONYMISED_PROVIDER_SESSION_ID, livenessScore: null }, { where: { userId }, transaction: tx });
    const withSelfie = rows.filter((r) => r.selfieKey !== null).map((r) => r.id);
    if (withSelfie.length > 0) await this.outbox.publish('verification.face.purge', userId, { userId, verificationIds: withSelfie }, tx);
    return { attempts: rows.length, selfies: withSelfie.length };
  }
}

/** Data export: the user's own attempts (no score, no image, no provider ids). */
@Injectable()
export class FaceVerificationExportContributor implements AccountExportContributor {
  readonly name = 'face_verifications';

  constructor(@InjectModel(FaceVerification) private readonly fvModel: typeof FaceVerification) {}

  async collect(userId: string): Promise<unknown> {
    const rows = await this.fvModel.findAll({
      attributes: ['id', 'status', 'rejectionReason', 'consentVersion', 'consentedAt', 'decidedAt', 'createdAt'],
      where: { userId },
      order: [['createdAt', 'ASC']],
    });
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      rejectionReason: r.rejectionReason,
      consentVersion: r.consentVersion,
      consentedAt: r.consentedAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}

/** M09 hook: a profile created after the selfie was approved starts verified. */
@Injectable()
export class FaceVerifiedProfileHook implements ProfileCreationHook {
  readonly name = 'face_verified_at';

  constructor(private readonly verification: VerificationService) {}

  async beforeCreate(userId: string, tx: Transaction): Promise<ProfileCreationAttrs> {
    return { faceVerifiedAt: await this.verification.faceVerifiedAtForNewProfile(userId, tx) };
  }
}

@Injectable()
export class VerificationHooksRegistrar implements OnModuleInit {
  constructor(
    private readonly deletion: AccountDeletionRegistry,
    private readonly exports: AccountExportRegistry,
    private readonly profileHooks: ProfileCreationHooks,
    private readonly handler: FaceVerificationDeletionHandler,
    private readonly contributor: FaceVerificationExportContributor,
    private readonly profileHook: FaceVerifiedProfileHook,
  ) {}

  onModuleInit(): void {
    this.deletion.register(this.handler);
    this.exports.register(this.contributor);
    this.profileHooks.register(this.profileHook);
  }
}

export const VERIFICATION_HOOKS = [
  FaceVerificationDeletionHandler,
  FaceVerificationExportContributor,
  FaceVerifiedProfileHook,
  VerificationHooksRegistrar,
];
