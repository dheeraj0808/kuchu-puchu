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
import { E164_REGEX, normalizeEmail, normalizePhone } from '../utils/identifier.util';

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
            return E164_REGEX.test(value);
          }
          // identifierType itself is invalid; reported by @IsEnum.
          return true;
        },
        defaultMessage(args: ValidationArguments): string {
          const type: unknown = (args.object as Record<string, unknown>).identifierType;
          return type === IdentifierType.Phone
            ? 'identifier must be a phone number in E.164 format (e.g. +919876543210)'
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
      description: 'Email address, or phone number in E.164 format (e.g. +919876543210)',
      example: 'jane@example.com',
      maxLength: 254,
    }),
    Transform(normalizeIdentifierTransform),
    IsString(),
    MaxLength(254),
    IsIdentifierForType(),
  );
}
