import { IdentifierType } from '../models/otp-verification.model';
import { IdentifierField, IdentifierTypeField } from './identifier.fields';

export class RequestOtpDto {
  @IdentifierTypeField()
  identifierType: IdentifierType;

  @IdentifierField()
  identifier: string;
}
