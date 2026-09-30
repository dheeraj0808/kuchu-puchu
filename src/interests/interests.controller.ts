import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { InterestResponse } from './dto/interest.response';
import { InterestsService } from './interests.service';

@ApiTags('interests')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@UseGuards(JwtAuthGuard)
@Controller('interests')
export class InterestsController {
  constructor(private readonly interests: InterestsService) {}

  @Get()
  @ApiOperation({ summary: 'List active interests available for selection' })
  @ApiOkResponse({ type: [InterestResponse] })
  list(): Promise<InterestResponse[]> {
    return this.interests.listActive();
  }
}
