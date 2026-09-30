import { ApiProperty } from '@nestjs/swagger';

import { UserResponseDto } from '../../users/dto/user-response.dto';

export class AuthTokensResponse {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
  @ApiProperty({ enum: ['Bearer'] }) tokenType: 'Bearer';
  @ApiProperty({ description: 'Access token lifetime in seconds', example: 900 })
  accessTokenExpiresIn: number;
  @ApiProperty({ format: 'date-time' }) refreshTokenExpiresAt: string;
  @ApiProperty({ type: UserResponseDto }) user: UserResponseDto;
}
