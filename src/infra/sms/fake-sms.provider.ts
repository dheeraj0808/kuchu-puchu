import { type OtpSms, SmsProvider } from './sms.provider';

/** Keeps the newest messages only, so a long-running dev server does not grow without bound. */
const KEPT = 50;

/**
 * Development and test double: keeps the messages in memory and logs nothing.
 * Never used in production (env validation refuses SMS_PROVIDER unset or "fake" there).
 */
export class FakeSmsProvider extends SmsProvider {
  readonly sent: OtpSms[] = [];
  /** Set to make the next sends fail, e.g. to test a provider outage. */
  failWith: Error | null = null;

  override async sendOtp(message: OtpSms): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push({ ...message });
    if (this.sent.length > KEPT) this.sent.splice(0, this.sent.length - KEPT);
  }

  /** The newest code sent to `to`, for tests. */
  lastCodeFor(to: string): string | undefined {
    return [...this.sent].reverse().find((m) => m.to === to)?.code;
  }

  clear(): void {
    this.sent.length = 0;
  }
}
