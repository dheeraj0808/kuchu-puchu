import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsIn, IsString, Length, Matches } from 'class-validator';

import { sanitizeText } from '../../common/utils/sanitize';
import type { ClientPlatform } from '../../common/utils/request-context';
import { OtpChannel } from '../models/otp-verification.model';
import { ChannelField, IdentifierField } from './identifier.fields';

export const PLATFORMS: readonly ClientPlatform[] = ['android', 'ios'];

/** POST /auth/otp/verify. Every device field is required: they bind the session to the install. */
export class OtpVerifyDto {
  @ChannelField()
  channel: OtpChannel;

  @IdentifierField()
  identifier: string;

  @ApiProperty({ example: '123456', pattern: '^\\d{4,10}$' })
  @IsString()
  @Matches(/^\d{4,10}$/, { message: 'otp must be 4-10 digits' })
  otp: string;

  @ApiProperty({ description: 'Per-install id from the app', example: 'b1f0c6c2-4d5e-4a8b-9f10-2c3d4e5f6a7b', maxLength: 100 })
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{1,100}$/, { message: 'deviceId must be 1-100 letters, digits or . _ : -' })
  deviceId: string;

  @ApiProperty({ example: "Jane's Pixel 8", maxLength: 100 })
  @Transform(({ value }: TransformFnParams): unknown => (typeof value === 'string' ? sanitizeText(value) : value))
  @IsString()
  @Length(1, 100)
  deviceName: string;

  @ApiProperty({ enum: PLATFORMS })
  @IsIn(PLATFORMS)
  platform: ClientPlatform;

  @ApiProperty({ example: '1.4.0', maxLength: 20 })
  @IsString()
  @Matches(/^[0-9A-Za-z.+-]{1,20}$/, { message: 'appVersion must be 1-20 characters like 1.4.0' })
  appVersion: string;
}
