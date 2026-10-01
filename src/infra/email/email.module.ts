import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EmailConfig } from '../../config/messaging.config';
import { EmailProvider } from './email.provider';
import { FakeEmailProvider } from './fake-email.provider';
import { SesEmailProvider } from './ses-email.provider';

/** SES when EMAIL_FROM and SES_REGION are set (required in production), otherwise the fake. */
export function createEmailProvider(cfg: EmailConfig): EmailProvider {
  return cfg.from && cfg.sesRegion ? new SesEmailProvider(cfg.sesRegion, cfg.from) : new FakeEmailProvider();
}

@Global()
@Module({
  providers: [
    {
      provide: EmailProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService): EmailProvider => createEmailProvider(config.getOrThrow<EmailConfig>('email')),
    },
  ],
  exports: [EmailProvider],
})
export class EmailModule {}
