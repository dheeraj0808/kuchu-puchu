import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsISO31661Alpha2, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import { PLACE_NAME_MAX } from '../profile.constants';
import { sanitizeText } from '../utils/sanitize.util';

const PLACE_REGEX = /^[\p{L}\p{M}\p{N} '.,()-]+$/u;

const place = ({ value }: TransformFnParams): unknown => {
  if (typeof value !== 'string') return value;
  const clean = sanitizeText(value);
  return clean === '' ? null : clean;
};

export class LocationDto {
  @ApiProperty({ example: 12.9716, minimum: -90, maximum: 90 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ example: 77.5946, minimum: -180, maximum: 180 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiPropertyOptional({ example: 'Bengaluru', maxLength: PLACE_NAME_MAX })
  @Transform(place)
  @IsOptional()
  @IsString()
  @MaxLength(PLACE_NAME_MAX)
  @Matches(PLACE_REGEX, { message: 'city contains unsupported characters' })
  city?: string | null;

  @ApiPropertyOptional({ example: 'Karnataka', maxLength: PLACE_NAME_MAX })
  @Transform(place)
  @IsOptional()
  @IsString()
  @MaxLength(PLACE_NAME_MAX)
  @Matches(PLACE_REGEX, { message: 'state contains unsupported characters' })
  state?: string | null;

  @ApiPropertyOptional({ example: 'IN', description: 'ISO 3166-1 alpha-2 country code' })
  @Transform(({ value }: TransformFnParams): unknown => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsOptional()
  @IsISO31661Alpha2()
  country?: string | null;
}
