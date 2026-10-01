import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel, SequelizeModule } from '@nestjs/sequelize';
import { Op, QueryTypes, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import type { RequestContext } from '../common/utils/request-context';
import { EventsModule } from '../events/events.module';
import { OutboxService } from '../events/outbox.service';
import { StorageProvider } from '../infra/storage/storage.provider';
import { SecurityEventType } from '../security/models/security-event.model';
import { SecurityEventsService } from '../security/security-events.service';
import { EXPORT_MAX_FAILED_PER_WINDOW, EXPORT_REQUEST_WINDOW_MS, EXPORT_URL_TTL_SECONDS } from './account.constants';
import { DataExportResponse, DataExportStartedResponse } from './dto/data-export.response';
import { DataExportRequest, DataExportStatus } from './models/data-export-request.model';
import { type AccountDeletionHandler, AccountDeletionRegistry } from './registry/account-registry';

/** POST /account/export and GET /account/export (guide M07). */
@Injectable()
export class DataExportService {
  constructor(
    @InjectModel(DataExportRequest) private readonly exportModel: typeof DataExportRequest,
    private readonly outbox: OutboxService,
    private readonly storage: StorageProvider,
    private readonly securityEvents: SecurityEventsService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * One request per 24 h (failed ones do not count). The user row is locked,
   * so two parallel requests cannot both pass the check. The row and the
   * data_export.requested event commit together; the worker builds the ZIP.
   */
  async request(userId: string, ctx: RequestContext): Promise<DataExportStartedResponse> {
    const created = await this.sequelize.transaction(async (tx) => {
      const [user] = await this.sequelize.query<{ id: string }>(
        'SELECT id FROM users WHERE id = :userId AND deleted_at IS NULL FOR UPDATE',
        { replacements: { userId }, type: QueryTypes.SELECT, transaction: tx },
      );
      if (!user) throw new AppException(ErrorCode.Unauthorized);
      const now = Date.now();
      const recent = await this.exportModel.findOne({
        where: {
          userId,
          status: { [Op.ne]: DataExportStatus.Failed },
          createdAt: { [Op.gt]: new Date(now - EXPORT_REQUEST_WINDOW_MS) },
        },
        order: [['createdAt', 'DESC']],
        transaction: tx,
      });
      if (recent) {
        const retryAfterSeconds = Math.max(1, Math.ceil((recent.createdAt.getTime() + EXPORT_REQUEST_WINDOW_MS - now) / 1000));
        throw new AppException(ErrorCode.TooManyRequests, { retryAfterSeconds });
      }
      // Failed builds do not use up the daily export, but at most EXPORT_MAX_FAILED_PER_WINDOW of them a day.
      const failed = await this.exportModel.findAll({
        attributes: ['createdAt'],
        where: { userId, status: DataExportStatus.Failed, createdAt: { [Op.gt]: new Date(now - EXPORT_REQUEST_WINDOW_MS) } },
        order: [['createdAt', 'ASC']],
        transaction: tx,
      });
      if (failed.length >= EXPORT_MAX_FAILED_PER_WINDOW) {
        const retryAfterSeconds = Math.max(1, Math.ceil((failed[0].createdAt.getTime() + EXPORT_REQUEST_WINDOW_MS - now) / 1000));
        throw new AppException(ErrorCode.TooManyRequests, { retryAfterSeconds });
      }
      const row = await this.exportModel.create({ userId, status: DataExportStatus.Pending }, { transaction: tx });
      await this.outbox.publish('data_export.requested', row.id, { requestId: row.id, userId }, tx);
      await this.securityEvents.record({
        eventType: SecurityEventType.DataExportRequested,
        userId,
        context: ctx,
        metadata: { requestId: row.id },
        transaction: tx,
        strict: true,
      });
      return row;
    });
    return { requestId: created.id, status: created.status };
  }

  /**
   * The latest request, or null. A ready export that has not expired gets a
   * presigned URL valid 15 minutes, made anew on every call (each one is
   * audited); once expires_at has passed it is reported as expired even
   * before the hourly job runs.
   */
  async latest(userId: string, ctx?: RequestContext): Promise<DataExportResponse | null> {
    const row = await this.exportModel.findOne({ where: { userId }, order: [['createdAt', 'DESC']] });
    if (!row) return null;
    const now = Date.now();
    const live = row.status === DataExportStatus.Ready && row.fileKey !== null && row.expiresAt !== null && row.expiresAt.getTime() > now;
    const status = row.status === DataExportStatus.Ready && !live ? DataExportStatus.Expired : row.status;
    const downloadUrl = live ? await this.storage.presignGet('private', row.fileKey as string, EXPORT_URL_TTL_SECONDS, 'kuchu-puchu-data-export.zip') : null;
    if (downloadUrl) {
      await this.securityEvents.record({ eventType: SecurityEventType.DataExportUrlIssued, userId, context: ctx, metadata: { requestId: row.id } });
    }
    return {
      requestId: row.id,
      status,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      downloadUrl,
      // The signature's own expiry is EXPORT_URL_TTL_SECONDS from signing, i.e. from now.
      downloadUrlExpiresAt: downloadUrl ? new Date(now + EXPORT_URL_TTL_SECONDS * 1000).toISOString() : null,
    };
  }
}

/** Account deletion: export rows go; their files are purged after the commit (data_export.purge). */
@Injectable()
export class DataExportsDeletionHandler implements AccountDeletionHandler {
  readonly name = 'data_exports';
  readonly order = 40;

  constructor(
    @InjectModel(DataExportRequest) private readonly exportModel: typeof DataExportRequest,
    private readonly outbox: OutboxService,
  ) {}

  async handle(userId: string, tx: Transaction): Promise<{ exportsDeleted: number }> {
    const rows = await this.exportModel.findAll({ attributes: ['id'], where: { userId }, transaction: tx });
    if (rows.length === 0) return { exportsDeleted: 0 };
    const requestIds = rows.map((r) => r.id);
    await this.exportModel.destroy({ where: { id: { [Op.in]: requestIds } }, transaction: tx });
    await this.outbox.publish('data_export.purge', userId, { userId, requestIds }, tx);
    return { exportsDeleted: rows.length };
  }
}

@Injectable()
class DataExportsRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: AccountDeletionRegistry,
    private readonly handler: DataExportsDeletionHandler,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.handler);
  }
}

/** The export table, its service and its deletion hook (API and worker). */
@Module({
  imports: [SequelizeModule.forFeature([DataExportRequest]), EventsModule],
  providers: [DataExportService, DataExportsDeletionHandler, DataExportsRegistrar],
  exports: [DataExportService, SequelizeModule],
})
export class DataExportsModule {}
