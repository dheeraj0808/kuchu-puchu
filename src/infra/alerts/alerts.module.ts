import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AlertsConfig } from '../../config/integrations.config';
import { AlertProvider } from './alert.provider';
import { LogAlertProvider, WebhookAlertProvider } from './webhook-alert.provider';

/** The webhook when ALERT_WEBHOOK_URL is set (always in production), otherwise log-only. */
@Global()
@Module({
  providers: [
    {
      provide: AlertProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AlertProvider => {
        const { webhookUrl, environment } = config.getOrThrow<AlertsConfig>('alerts');
        return webhookUrl ? new WebhookAlertProvider(webhookUrl, environment) : new LogAlertProvider();
      },
    },
  ],
  exports: [AlertProvider],
})
export class AlertsModule {}
