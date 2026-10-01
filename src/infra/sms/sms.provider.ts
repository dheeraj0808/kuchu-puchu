/** One OTP text message. `to` is E.164; `code` is the plaintext OTP and must never be logged. */
export interface OtpSms {
  to: string;
  code: string;
  expiresInMinutes: number;
}

/**
 * Port for SMS delivery (guide §4.4). The real provider will send through a
 * DLT-registered sender and template (SMS_SENDER_ID, SMS_DLT_TEMPLATE_ID);
 * until then only the fake exists.
 */
export abstract class SmsProvider {
  /** Rejects when the message could not be handed to the provider. */
  abstract sendOtp(message: OtpSms): Promise<void>;
}
