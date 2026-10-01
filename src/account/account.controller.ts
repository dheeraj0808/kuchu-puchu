import { Controller, Delete, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { MessageResponse } from '../auth/dto/message.response';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireReauthGuard } from '../auth/guards/require-reauth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestContext } from '../common/utils/request-context';
import { AccountService } from './account.service';

@ApiTags('account')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('account')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Delete()
  @HttpCode(HttpStatus.OK)
  @UseGuards(RequireReauthGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Permanently delete the current account',
    description:
      'Revokes all sessions, deactivates and scrubs the profile, frees the email/phone and soft-deletes the user. Audit records are retained.',
  })
  @ApiOkResponse({ type: MessageResponse })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'REAUTH_REQUIRED: confirm with POST /auth/reauth/verify first (valid 10 min)' })
  async delete(@CurrentUser() user: AuthenticatedUser, @ClientContext() ctx: RequestContext): Promise<MessageResponse> {
    await this.account.deleteAccount(user, ctx);
    return { message: 'Account deleted' };
  }
}
