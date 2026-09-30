import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Opaque refresh token issued at login/refresh' })
  @IsString()
  @Length(20, 512)
  refreshToken: string;
}
