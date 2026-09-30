import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsEnum,
  IsString,
  isEmail,
  MaxLength,
  registerDecorator,
  type ValidationArguments,
} from 'class-validator';

import { IdentifierType } from '../models/otp-verification.model';
import { normalizeEmail, normalizePhone, toE164 } from '../utils/identifier.util';

function normalizeIdentifierTransform({ value, obj }: TransformFnParams): unknown {
  if (typeof value !== 'string') return value;
  const type: unknown = (obj as Record<string, unknown>).identifierType;
  if (type === IdentifierType.Email) return normalizeEmail(value);
  if (type === IdentifierType.Phone) return normalizePhone(value);
  return value.trim();
}

/** Validates the identifier according to the sibling `identifierType`. */
function IsIdentifierForType(): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isIdentifierForType',
      target: target.constructor,
      propertyName: propertyName.toString(),
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          if (typeof value !== 'string') return false;
          const type: unknown = (args.object as Record<string, unknown>).identifierType;
          if (type === IdentifierType.Email) {
            return value.length <= 254 && isEmail(value);
          }
          if (type === IdentifierType.Phone) {
            // The transform already produced E.164 for every valid number.
            return toE164(value) === value;
          }
          // identifierType itself is invalid; reported by @IsEnum.
          return true;
        },
        defaultMessage(args: ValidationArguments): string {
          const type: unknown = (args.object as Record<string, unknown>).identifierType;
          return type === IdentifierType.Phone
            ? 'identifier must be a valid phone number (e.g. +919876543210 or 9876543210)'
            : 'identifier must be a valid email address';
        },
      },
    });
  };
}

export function IdentifierTypeField(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({ enum: IdentifierType, example: IdentifierType.Email }),
    IsEnum(IdentifierType),
  );
}

export function IdentifierField(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({
      description: 'Email address, or phone number (E.164, or an Indian number without the country code)',
      example: 'jane@example.com',
      maxLength: 254,
    }),
    Transform(normalizeIdentifierTransform),
    IsString(),
    MaxLength(254),
    IsIdentifierForType(),
  );
}
