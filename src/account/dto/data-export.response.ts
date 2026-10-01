import { ApiProperty } from '@nestjs/swagger';

import { DataExportStatus } from '../models/data-export-request.model';

export class DataExportStartedResponse {
  @ApiProperty({ format: 'uuid' }) requestId: string;
  @ApiProperty({ enum: DataExportStatus, example: DataExportStatus.Pending }) status: DataExportStatus;
}

export class DataExportResponse {
  @ApiProperty({ format: 'uuid' }) requestId: string;
  @ApiProperty({ enum: DataExportStatus }) status: DataExportStatus;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) completedAt: string | null;
  @ApiProperty({ format: 'date-time', nullable: true, type: String, description: 'The download link works until then (24 h after it was built)' })
  expiresAt: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Presigned URL, valid 15 minutes; made anew on every call. Only while ready.' })
  downloadUrl: string | null;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) downloadUrlExpiresAt: string | null;
}

export class AccountDeletedResponse {
  @ApiProperty({ example: 'Account deleted' }) message: string;
  @ApiProperty({ description: 'Store subscriptions are not cancelled by deleting the account' }) storeSubscriptionNotice: string;
}
