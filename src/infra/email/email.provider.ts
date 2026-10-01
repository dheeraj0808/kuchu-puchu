/** One email. `to` and the body are PII / secrets and must never be logged. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Port for email delivery (guide §4.4): SES in production, a fake elsewhere. */
export abstract class EmailProvider {
  /** Rejects when the message could not be handed to the provider. */
  abstract send(message: EmailMessage): Promise<void>;
}
