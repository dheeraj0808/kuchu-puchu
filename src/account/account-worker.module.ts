import { Inject, Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import type { Redis } from 'ioredis';
import { Op } from 'sequelize';

import { AuthAccountHooksModule } from '../auth/account-hooks';
import { BansModule } from '../bans/bans.module';
import { deriveKey, open } from '../common/utils/sealed-box';
import { buildZip } from '../common/utils/zip';
import type { OutboxConfig } from '../config/outbox.config';
import type { SecurityConfig } from '../config/security.config';
import { EventsModule } from '../events/events.module';
import { type DeliveredEvent, type EventHandler, HandlerRegistry } from '../events/handler-registry';
import { OUTBOX_CONFIG } from '../events/outbox.constants';
import { errorClassOf } from '../infra/alerts/alert.provider';
import { EmailProvider } from '../infra/email/email.provider';
import { REDIS_CLIENT } from '../infra/redis/redis.module';
import { StorageProvider } from '../infra/storage/storage.provider';
import type { JobSchedule, PeriodicJob } from '../jobs/periodic-job';
import { PeriodicJobRegistry } from '../jobs/periodic-job';
import { ProfilesModule } from '../profiles/profiles.module';
import { SecurityEventType } from '../security/models/security-event.model';
import { SecurityEventsService } from '../security/security-events.service';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import {
  DELETION_MAIL_KEY_PURPOSE,
  deletionMailKey,
  DELETION_MAIL_TTL_SECONDS,
  EXPORT_LINK_LIFETIME_MS,
  exportFileKey,
} from './account.constants';
import { DataExportsModule } from './data-export.service';
import { DataExportRequest, DataExportStatus } from './models/data-export-request.model';
import { AccountExportRegistry } from './registry/account-registry';

/** Appendix B: data exports past expires_at. Hourly, at minute 17. */
export const DATA_EXPORT_EXPIRY_SCHEDULE: JobSchedule = { pattern: '17 * * * *' };
const EXPIRY_BATCH = 500;

/**
 * data_export.requested → builds the ZIP (one JSON file per contributor),
 * uploads it to the private bucket as exports/<id>.zip, marks the request
 * ready for 24 h and emails "your export is ready" (no link). Idempotent: a
 * request that is no longer pending or processing is left alone, and a retry
 * overwrites the same key. The last failed attempt marks the request failed.
 */
@Injectable()
export class DataExportBuildHandler implements EventHandler<'data_export.requested'> {
  readonly name = 'account.build_data_export';
  readonly eventType = 'data_export.requested' as const;
  private readonly logger = new Logger(DataExportBuildHandler.name);

  constructor(
    @InjectModel(DataExportRequest) private readonly exportModel: typeof DataExportRequest,
    private readonly contributors: AccountExportRegistry,
    private readonly storage: StorageProvider,
    private readonly email: EmailProvider,
    private readonly users: UsersService,
    private readonly securityEvents: SecurityEventsService,
    @Inject(OUTBOX_CONFIG) private readonly outboxCfg: OutboxConfig,
  ) {}

  async handle(event: DeliveredEvent<'data_export.requested'>): Promise<void> {
    const { requestId, userId } = event.payload;
    const request = await this.exportModel.findOne({ where: { id: requestId, userId } });
    if (!request) {
      // Deleted (account deletion), maybe mid-build: make sure no file is left behind.
      await this.storage.delete('private', exportFileKey(requestId));
      return;
    }
    // Already done: nothing to do.
    if (request.status !== DataExportStatus.Pending && request.status !== DataExportStatus.Processing) return;
    try {
      await request.update({ status: DataExportStatus.Processing });
      const zip = await this.build(userId);
      const fileKey = exportFileKey(request.id);
      await this.storage.put({ bucket: 'private', key: fileKey, body: zip, contentType: 'application/zip' });
      const now = new Date();
      const [updated] = await this.exportModel.update(
        { status: DataExportStatus.Ready, fileKey, completedAt: now, expiresAt: new Date(now.getTime() + EXPORT_LINK_LIFETIME_MS) },
        { where: { id: request.id, status: DataExportStatus.Processing } },
      );
      if (updated === 0) {
        // Deleted while building (account deletion): do not leave the file behind.
        await this.storage.delete('private', fileKey);
        return;
      }
      // Email first: once the row is ready a retry stops early. notify() never throws.
      await this.notify(userId);
      await this.securityEvents.record({ eventType: SecurityEventType.DataExportReady, userId, metadata: { requestId, bytes: zip.length } });
    } catch (err) {
      if (event.attempt >= this.outboxCfg.maxAttempts) {
        const [markedFailed] = await this.exportModel.update(
          { status: DataExportStatus.Failed },
          { where: { id: request.id, status: DataExportStatus.Processing } },
        );
        // A file uploaded before the failure would never be expired: remove it (never a ready export's file).
        if (markedFailed > 0) await this.storage.delete('private', exportFileKey(request.id)).catch(() => undefined);
        await this.securityEvents.record({ eventType: SecurityEventType.DataExportFailed, userId, metadata: { requestId, err: errorClassOf(err) } });
      }
      throw err;
    }
  }

  private async build(userId: string): Promise<Buffer> {
    const generatedAt = new Date();
    const contributors = this.contributors.all();
    const files = [];
    for (const c of contributors) {
      files.push({ name: `${c.name}.json`, data: Buffer.from(JSON.stringify(await c.collect(userId), null, 2)) });
    }
    const manifest = { generatedAt: generatedAt.toISOString(), userId, files: files.map((f) => f.name) };
    return buildZip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) }, ...files], generatedAt);
  }

  /** The email has no link: the app fetches a short-lived URL after sign-in. A failure here never fails the export. */
  private async notify(userId: string): Promise<void> {
    try {
      const user = await this.users.findById(userId);
      if (!user?.email) return;
      await this.email.send({
        to: user.email,
        subject: 'Your Kuchu Puchu data export is ready',
        text: 'Your data export is ready. Open the Kuchu Puchu app and go to Settings → Privacy → Download my data to save it. It is available for 24 hours.',
      });
    } catch (err) {
      this.logger.warn({ err: errorClassOf(err) }, 'Could not send the export-ready email');
    }
  }
}

/** data_export.purge → deletes the export files of a deleted account. Idempotent (deleting a missing file succeeds). */
@Injectable()
export class DataExportPurgeHandler implements EventHandler<'data_export.purge'> {
  readonly name = 'account.purge_data_exports';
  readonly eventType = 'data_export.purge' as const;

  constructor(private readonly storage: StorageProvider) {}

  async handle(event: DeliveredEvent<'data_export.purge'>): Promise<void> {
    for (const requestId of event.payload.requestIds) await this.storage.delete('private', exportFileKey(requestId));
  }
}

/**
 * account.deleted → the confirmation email. The address was put in
 * kp:deletion-mail:<userId> (AES-256-GCM sealed) before the scrub; GETDEL
 * (Redis 6.2+) takes it, so the email is sent once. If sending fails the key
 * is put back for the retry, except after the last attempt. No key (no email
 * on the account, or already sent) → nothing to do.
 */
@Injectable()
export class AccountDeletedMailHandler implements EventHandler<'account.deleted'> {
  readonly name = 'account.deletion_confirmation_email';
  readonly eventType = 'account.deleted' as const;
  private readonly logger = new Logger(AccountDeletedMailHandler.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly email: EmailProvider,
    private readonly config: ConfigService,
    @Inject(OUTBOX_CONFIG) private readonly outboxCfg: OutboxConfig,
  ) {}

  async handle(event: DeliveredEvent<'account.deleted'>): Promise<void> {
    const key = deletionMailKey(event.payload.userId);
    const sealed = await this.redis.getdel(key);
    if (!sealed) return;
    const secret = this.config.getOrThrow<SecurityConfig>('security').identifierHashSecret;
    const to = open(deriveKey(secret, DELETION_MAIL_KEY_PURPOSE), sealed, event.payload.userId);
    if (!to) {
      // Wrong key (OTP_HASH_SECRET rotated) or a value sealed for another user: nothing can be sent.
      this.logger.warn({ outboxId: event.outboxId }, 'Deletion confirmation address could not be opened; no email sent');
      return;
    }
    try {
      await this.email.send({
        to,
        subject: 'Your Kuchu Puchu account has been deleted',
        text:
          'Your Kuchu Puchu account and profile have been deleted. If you had a subscription through Google Play or the App Store, cancel it in the store to stop being charged. If you did not ask for this, contact support.',
      });
    } catch (err) {
      // Put back (sealed) for the retry; after the last attempt the address is gone for good.
      if (event.attempt < this.outboxCfg.maxAttempts) await this.redis.set(key, sealed, 'EX', DELETION_MAIL_TTL_SECONDS, 'NX');
      throw err;
    }
  }
}

/** Hourly: ready exports past expires_at become expired and their files are deleted. */
@Injectable()
export class DataExportExpiryJob implements PeriodicJob {
  readonly name = 'account.data_export_expiry';
  readonly schedule = DATA_EXPORT_EXPIRY_SCHEDULE;
  private readonly logger = new Logger(DataExportExpiryJob.name);

  constructor(
    @InjectModel(DataExportRequest) private readonly exportModel: typeof DataExportRequest,
    private readonly storage: StorageProvider,
  ) {}

  async run(): Promise<void> {
    await this.expire();
  }

  async expire(): Promise<number> {
    let expired = 0;
    for (;;) {
      const rows = await this.exportModel.findAll({
        attributes: ['id', 'fileKey'],
        where: { status: DataExportStatus.Ready, expiresAt: { [Op.lte]: new Date() } },
        order: [['id', 'ASC']],
        limit: EXPIRY_BATCH,
      });
      if (rows.length === 0) break;
      let failed = 0;
      for (const row of rows) {
        try {
          // File first: if the delete fails the row stays ready and the next tick retries.
          if (row.fileKey) await this.storage.delete('private', row.fileKey);
          await this.exportModel.update({ status: DataExportStatus.Expired }, { where: { id: row.id, status: DataExportStatus.Ready } });
          expired++;
        } catch (err) {
          failed++;
          this.logger.warn({ err: errorClassOf(err), requestId: row.id }, 'Could not expire a data export; retried next tick');
        }
      }
      // A batch where nothing could be expired would be read again forever.
      if (rows.length < EXPIRY_BATCH || failed === rows.length) break;
    }
    this.logger.log({ expired }, 'Data export expiry finished');
    return expired;
  }
}

@Injectable()
class AccountWorkerRegistrar implements OnModuleInit {
  constructor(
    private readonly handlers: HandlerRegistry,
    private readonly jobs: PeriodicJobRegistry,
    private readonly build: DataExportBuildHandler,
    private readonly purge: DataExportPurgeHandler,
    private readonly mail: AccountDeletedMailHandler,
    private readonly expiry: DataExportExpiryJob,
  ) {}

  onModuleInit(): void {
    this.handlers.register(this.build);
    this.handlers.register(this.purge);
    this.handlers.register(this.mail);
    this.jobs.register(this.expiry);
  }
}

/**
 * Worker only: M07's outbox handlers and job. Imports the modules whose
 * export contributors fill the ZIP (they register themselves).
 */
@Module({
  imports: [EventsModule, DataExportsModule, UsersModule, ProfilesModule, AuthAccountHooksModule, BansModule],
  providers: [DataExportBuildHandler, DataExportPurgeHandler, AccountDeletedMailHandler, DataExportExpiryJob, AccountWorkerRegistrar],
})
export class AccountWorkerModule {}
