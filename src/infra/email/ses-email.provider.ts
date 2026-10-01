import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';

import { type EmailMessage, EmailProvider } from './email.provider';

/** Never wait on SES longer than this inside a request. */
export const SES_TIMEOUT_MS = 5_000;

/**
 * Amazon SES v2. Credentials come from the IAM role (guide Appendix D: never
 * keys in production). Errors are rethrown as-is; callers log the class only.
 */
export class SesEmailProvider extends EmailProvider {
  private readonly client: SESv2Client;

  constructor(
    region: string,
    private readonly from: string,
    client?: SESv2Client,
  ) {
    super();
    this.client = client ?? new SESv2Client({ region, maxAttempts: 2 });
  }

  override async send(message: EmailMessage): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: message.text, Charset: 'UTF-8' },
              ...(message.html ? { Html: { Data: message.html, Charset: 'UTF-8' } } : {}),
            },
          },
        },
      }),
      { abortSignal: AbortSignal.timeout(SES_TIMEOUT_MS) },
    );
  }
}
