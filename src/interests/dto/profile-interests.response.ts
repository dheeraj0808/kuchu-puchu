import { ApiProperty } from '@nestjs/swagger';

import { InterestResponse } from './interest.response';

export class ProfileInterestsResponse {
  @ApiProperty({ type: [InterestResponse] }) interests: InterestResponse[];
  @ApiProperty({ example: 10, description: 'Maximum number of interests a user may select' })
  maxInterests: number;
}
