import { OtpChannel } from '../models/otp-verification.model';
import { ChannelField, IdentifierField } from './identifier.fields';

/** POST /auth/otp/request */
export class OtpRequestDto {
  @ChannelField()
  channel: OtpChannel;

  @IdentifierField()
  identifier: string;
}
