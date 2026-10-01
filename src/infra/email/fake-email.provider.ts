import { type EmailMessage, EmailProvider } from './email.provider';

const KEPT = 50;

/** Development and test double: keeps the newest messages in memory and logs nothing. */
export class FakeEmailProvider extends EmailProvider {
  readonly sent: EmailMessage[] = [];
  failWith: Error | null = null;

  override async send(message: EmailMessage): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push({ ...message });
    if (this.sent.length > KEPT) this.sent.splice(0, this.sent.length - KEPT);
  }

  lastTo(to: string): EmailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to);
  }

  clear(): void {
    this.sent.length = 0;
  }
}
