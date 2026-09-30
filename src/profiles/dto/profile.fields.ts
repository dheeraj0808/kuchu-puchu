import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams, Type } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  registerDecorator,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { Gender } from '../models/profile.model';
import {
  BIO_MAX,
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  MAX_DATING_AGE,
  MIN_DATING_AGE,
} from '../profile.constants';
import { calculateAge, parseIsoDate } from '../utils/age.util';
import { sanitizeText } from '../../common/utils/sanitize';
import { LocationDto } from './location.dto';

// Letters (any script) and combining marks, with inner spaces, apostrophes, hyphens and dots.
const DISPLAY_NAME_REGEX = /^[\p{L}\p{M}](?:[\p{L}\p{M}' .-]*[\p{L}\p{M}.])?$/u;
// Letters, digits, marks and common punctuation for short single-line text.
const SHORT_TEXT_REGEX = /^[\p{L}\p{M}\p{N} '.,&()/+#-]+$/u;

/** Sanitizes strings; empty strings become null so optional fields can be cleared. */
export const sanitize =
  (multiline = false) =>
  ({ value }: TransformFnParams): unknown => {
    if (typeof value !== 'string') return value;
    const clean = sanitizeText(value, multiline);
    return clean === '' ? null : clean;
  };

/** Present-but-null is rejected; absent is allowed (for PATCH of required fields). */
const IfDefined = (): PropertyDecorator => ValidateIf((_o: object, v: unknown) => v !== undefined);

function IsValidDateOfBirth(): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isValidDateOfBirth',
      target: target.constructor,
      propertyName: propertyName.toString(),
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          const dob = parseIsoDate(value);
          if (!dob || dob.getTime() > Date.now()) return false;
          const age = calculateAge(value);
          return age !== null && age >= MIN_DATING_AGE && age <= MAX_DATING_AGE;
        },
        defaultMessage: (): string =>
          `dateOfBirth must be a valid past date (YYYY-MM-DD) and you must be at least ${MIN_DATING_AGE} years old`,
      },
    });
  };
}

export const DisplayNameField = (required: boolean): PropertyDecorator =>
  applyDecorators(
    required
      ? ApiProperty({ example: 'Priya', minLength: DISPLAY_NAME_MIN, maxLength: DISPLAY_NAME_MAX })
      : ApiPropertyOptional({ example: 'Priya', minLength: DISPLAY_NAME_MIN, maxLength: DISPLAY_NAME_MAX }),
    ...(required ? [] : [IfDefined()]),
    Transform(sanitize()),
    IsString(),
    Length(DISPLAY_NAME_MIN, DISPLAY_NAME_MAX),
    Matches(DISPLAY_NAME_REGEX, {
      message: 'displayName may only contain letters, spaces, apostrophes, hyphens and dots',
    }),
  );

export const DateOfBirthField = (): PropertyDecorator =>
  applyDecorators(
    ApiProperty({ example: '1998-04-21', format: 'date', description: `Must be at least ${MIN_DATING_AGE}` }),
    Transform(({ value }: TransformFnParams): unknown => (typeof value === 'string' ? value.trim() : value)),
    IsValidDateOfBirth(),
  );

export const GenderField = (required: boolean): PropertyDecorator =>
  applyDecorators(
    required ? ApiProperty({ enum: Gender }) : ApiPropertyOptional({ enum: Gender }),
    ...(required ? [] : [IfDefined()]),
    IsEnum(Gender),
  );

export const BioField = (): PropertyDecorator =>
  applyDecorators(
    ApiPropertyOptional({ maxLength: BIO_MAX, nullable: true, type: String }),
    Transform(sanitize(true)),
    IsOptional(),
    IsString(),
    MaxLength(BIO_MAX),
  );

export const ShortTextField = (max: number, example: string): PropertyDecorator =>
  applyDecorators(
    ApiPropertyOptional({ maxLength: max, nullable: true, type: String, example }),
    Transform(sanitize()),
    IsOptional(),
    IsString(),
    MaxLength(max),
    Matches(SHORT_TEXT_REGEX, { message: '$property contains unsupported characters' }),
  );

export const LocationField = (): PropertyDecorator =>
  applyDecorators(
    ApiPropertyOptional({ type: LocationDto, nullable: true }),
    IsOptional(),
    ValidateNested(),
    Type(() => LocationDto),
  );
