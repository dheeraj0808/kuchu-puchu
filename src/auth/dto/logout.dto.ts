import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class LogoutDto {
  @ApiProperty({ description: 'Refresh token of the session to terminate' })
  @IsString()
  @Length(20, 512)
  refreshToken: string;
}
