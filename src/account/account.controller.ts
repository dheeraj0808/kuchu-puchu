import { Controller, Delete, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireReauthGuard } from '../auth/guards/require-reauth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestContext } from '../common/utils/request-context';
import { STORE_SUBSCRIPTION_NOTICE } from './account.constants';
import { AccountService } from './account.service';
import { DataExportService } from './data-export.service';
import { AccountDeletedResponse, DataExportResponse, DataExportStartedResponse } from './dto/data-export.response';

const REAUTH = 'REAUTH_REQUIRED: confirm with POST /auth/reauth/verify first (valid 10 min)';

@ApiTags('account')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('account')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly dataExports: DataExportService,
  ) {}

  @Delete()
  @HttpCode(HttpStatus.OK)
  @UseGuards(RequireReauthGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Permanently delete the current account',
    description:
      'Signs out every device, deletes or scrubs the account data of every module, frees the email and phone, and sends a confirmation email. Store subscriptions (Google Play / App Store) are NOT cancelled: the response says so. Audit records are kept with hashed identifiers only.',
  })
  @ApiOkResponse({ type: AccountDeletedResponse })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: REAUTH })
  async delete(@CurrentUser() user: AuthenticatedUser, @ClientContext() ctx: RequestContext): Promise<AccountDeletedResponse> {
    await this.account.delete(user.userId, ctx);
    return { message: 'Account deleted', storeSubscriptionNotice: STORE_SUBSCRIPTION_NOTICE };
  }

  @Post('export')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(RequireReauthGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Start a data export',
    description:
      'One per 24 hours. The export is built in the background; an email says when it is ready (it contains no link). Poll GET /account/export for the status and the download URL.',
  })
  @ApiAcceptedResponse({ type: DataExportStartedResponse })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: REAUTH })
  @ApiTooManyRequestsResponse({ description: 'TOO_MANY_REQUESTS: one export per 24 h (details.retryAfterSeconds)' })
  startExport(@CurrentUser() user: AuthenticatedUser, @ClientContext() ctx: RequestContext): Promise<DataExportStartedResponse> {
    return this.dataExports.request(user.userId, ctx);
  }

  @Get('export')
  @ApiExtraModels(DataExportResponse)
  @ApiOperation({
    summary: 'Latest data export',
    description: 'null when none was requested. When ready, a presigned download URL valid 15 minutes, made anew on every call.',
  })
  @ApiOkResponse({ schema: { nullable: true, allOf: [{ $ref: getSchemaPath(DataExportResponse) }] } })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  latestExport(@CurrentUser() user: AuthenticatedUser, @ClientContext() ctx: RequestContext): Promise<DataExportResponse | null> {
    return this.dataExports.latest(user.userId, ctx);
  }
}
