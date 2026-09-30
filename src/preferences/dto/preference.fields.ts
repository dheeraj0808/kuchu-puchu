import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  Max,
  Min,
  registerDecorator,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';

import { Gender } from '../../profiles/models/profile.model';
import { MAX_DATING_AGE, MIN_DATING_AGE } from '../../profiles/profile.constants';
import { RelationshipIntent } from '../models/dating-preference.model';

/** Absolute bound only; the configured distance range is enforced in the service. */
export const DISTANCE_HARD_MAX_KM = 20000;

const Swagger = (required: boolean, opts: Parameters<typeof ApiProperty>[0]): PropertyDecorator =>
  required ? ApiProperty(opts) : ApiPropertyOptional(opts);

/** For PATCH: absent is allowed, explicit null is rejected. */
const IfDefined = (): PropertyDecorator => ValidateIf((_o: object, v: unknown) => v !== undefined);
const optional = (required: boolean): PropertyDecorator[] => (required ? [] : [IfDefined()]);

/** maxAge must be >= minAge when both are present in the same payload. */
function IsNotBelowMinAge(): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isNotBelowMinAge',
      target: target.constructor,
      propertyName: propertyName.toString(),
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const min = (args.object as { minAge?: unknown }).minAge;
          return typeof value !== 'number' || typeof min !== 'number' || value >= min;
        },
        defaultMessage: (): string => 'maxAge must not be below minAge',
      },
    });
  };
}

export const AgeField = (kind: 'min' | 'max', required: boolean): PropertyDecorator =>
  applyDecorators(
    Swagger(required, {
      minimum: MIN_DATING_AGE,
      maximum: MAX_DATING_AGE,
      example: kind === 'min' ? 24 : 32,
      type: Number,
    }),
    ...optional(required),
    IsInt(),
    Min(MIN_DATING_AGE),
    Max(MAX_DATING_AGE),
    ...(kind === 'max' ? [IsNotBelowMinAge()] : []),
  );

export const PreferredGendersField = (required: boolean): PropertyDecorator =>
  applyDecorators(
    Swagger(required, { enum: Gender, isArray: true, example: [Gender.Woman] }),
    ...optional(required),
    IsArray(),
    ArrayMinSize(1),
    ArrayMaxSize(Object.values(Gender).length),
    ArrayUnique({ message: 'preferredGenders must not contain duplicates' }),
    IsEnum(Gender, { each: true }),
  );

export const MaxDistanceField = (required: boolean): PropertyDecorator =>
  applyDecorators(
    Swagger(required, { example: 50, description: 'Kilometres; allowed range is configurable (default 1–500)', type: Number }),
    ...optional(required),
    IsInt(),
    Min(1),
    Max(DISTANCE_HARD_MAX_KM),
  );

export const RelationshipIntentField = (required: boolean): PropertyDecorator =>
  applyDecorators(
    Swagger(required, { enum: RelationshipIntent }),
    ...optional(required),
    IsEnum(RelationshipIntent),
  );
