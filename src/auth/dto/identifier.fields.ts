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

import { OtpChannel } from '../models/otp-verification.model';
import { normalizeEmail, normalizePhone, toE164 } from '../utils/identifier.util';

function normalizeIdentifierTransform({ value, obj }: TransformFnParams): unknown {
  if (typeof value !== 'string') return value;
  const channel: unknown = (obj as Record<string, unknown>).channel;
  if (channel === OtpChannel.Email) return normalizeEmail(value);
  if (channel === OtpChannel.Sms) return normalizePhone(value);
  return value.trim();
}

/** Validates the identifier according to the sibling `channel` (sms: phone, email: email). */
function IsIdentifierForType(): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isIdentifierForType',
      target: target.constructor,
      propertyName: propertyName.toString(),
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          if (typeof value !== 'string') return false;
          const channel: unknown = (args.object as Record<string, unknown>).channel;
          if (channel === OtpChannel.Email) {
            return value.length <= 254 && isEmail(value);
          }
          if (channel === OtpChannel.Sms) {
            // The transform already produced E.164 for every valid number.
            return toE164(value) === value;
          }
          // channel itself is invalid; reported by @IsEnum.
          return true;
        },
        defaultMessage(args: ValidationArguments): string {
          const channel: unknown = (args.object as Record<string, unknown>).channel;
          return channel === OtpChannel.Sms
            ? 'identifier must be a valid phone number (e.g. +919876543210 or 9876543210)'
            : 'identifier must be a valid email address';
        },
      },
    });
  };
}

export function ChannelField(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({ enum: OtpChannel, example: OtpChannel.Sms, description: 'sms: identifier is a phone number; email: an email address' }),
    IsEnum(OtpChannel),
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
