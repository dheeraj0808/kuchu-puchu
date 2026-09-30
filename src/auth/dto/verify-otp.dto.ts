import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { IdentifierType } from '../models/otp-verification.model';
import { IdentifierField, IdentifierTypeField } from './identifier.fields';

export class VerifyOtpDto {
  @IdentifierTypeField()
  identifierType: IdentifierType;

  @IdentifierField()
  identifier: string;

  @ApiProperty({ example: '123456', pattern: '^\\d{4,10}$' })
  @IsString()
  @Matches(/^\d{4,10}$/, { message: 'otp must be 4-10 digits' })
  otp: string;

  @ApiPropertyOptional({ example: 'ios-8F2C1A', maxLength: 128 })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{1,128}$/, { message: 'deviceId contains invalid characters' })
  deviceId?: string;

  @ApiPropertyOptional({ example: "Jane's iPhone", maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceName?: string;
}
