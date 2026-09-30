import { Logger } from '@nestjs/common';

import { type Alert, AlertProvider, errorClassOf, formatAlert, safeAlertValue } from './alert.provider';

export const ALERT_WEBHOOK_TIMEOUT_MS = 3_000;

/** Posts a Slack-compatible `{ "text": … }` body to ALERT_WEBHOOK_URL. */
export class WebhookAlertProvider extends AlertProvider {
  private readonly logger = new Logger(WebhookAlertProvider.name);

  constructor(
    private readonly url: string,
    private readonly environment: string,
    private readonly timeoutMs = ALERT_WEBHOOK_TIMEOUT_MS,
  ) {
    super();
  }

  override async send(alert: Alert): Promise<void> {
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: formatAlert(alert, this.environment) }),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
      if (!res.ok) {
        this.logger.error({ kind: alert.kind, status: res.status }, 'Alert webhook rejected the alert');
      }
    } catch (err) {
      // The URL is a secret; log the error class only.
      this.logger.error({ kind: alert.kind, err: errorClassOf(err) }, 'Alert webhook failed');
    }
  }
}

/** Used when no webhook is configured (outside production): the alert is only logged. */
export class LogAlertProvider extends AlertProvider {
  private readonly logger = new Logger('Alert');

  override async send(alert: Alert): Promise<void> {
    this.logger.error(
      {
        kind: alert.kind,
        eventType: safeAlertValue(alert.eventType),
        outboxId: safeAlertValue(alert.outboxId),
        handler: alert.handler === undefined ? undefined : safeAlertValue(alert.handler),
        count: alert.count,
        errorClass: safeAlertValue(alert.errorClass),
      },
      'ALERT',
    );
  }
}
