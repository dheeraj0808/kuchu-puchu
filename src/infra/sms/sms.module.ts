import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { SmsConfig } from '../../config/messaging.config';
import { FakeSmsProvider } from './fake-sms.provider';
import { SmsProvider } from './sms.provider';

/**
 * The SMS adapter named by SMS_PROVIDER. Only "fake" exists today; any other
 * name fails at boot until its adapter is added (production already refuses
 * "fake" in env validation, so production cannot start without a real one).
 */
export function createSmsProvider(cfg: SmsConfig): SmsProvider {
  if (cfg.provider === 'fake') return new FakeSmsProvider();
  throw new Error(`SMS provider "${cfg.provider}" is not available yet; only "fake" is implemented`);
}

@Global()
@Module({
  providers: [
    {
      provide: SmsProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SmsProvider => createSmsProvider(config.getOrThrow<SmsConfig>('sms')),
    },
  ],
  exports: [SmsProvider],
})
export class SmsModule {}
