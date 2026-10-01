import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';

import { OtpChannel } from '../models/otp-verification.model';

/** POST /auth/reauth/request */
export class ReauthRequestDto {
  @ApiPropertyOptional({
    enum: OtpChannel,
    description: "Default: sms if the account's phone is verified, else email",
  })
  @IsOptional()
  @IsEnum(OtpChannel)
  channel?: OtpChannel;
}

/** POST /auth/reauth/verify */
export class ReauthVerifyDto {
  @ApiProperty({ example: '123456', pattern: '^\\d{4,10}$' })
  @IsString()
  @Matches(/^\d{4,10}$/, { message: 'otp must be 4-10 digits' })
  otp: string;
}
