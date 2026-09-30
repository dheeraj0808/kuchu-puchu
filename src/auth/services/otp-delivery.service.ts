import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';
import type { OtpConfig } from '../../config/otp.config';
import type { IdentifierType } from '../models/otp-verification.model';
import { maskIdentifier } from '../utils/mask.util';

/** Port for delivering OTPs over email/SMS. */
export abstract class OtpDeliveryService {
  abstract send(type: IdentifierType, identifier: string, otp: string): Promise<void>;
}

/**
 * Development-only delivery. OTPs are NEVER passed to the application logger;
 * when echo is enabled they are written straight to stdout.
 */
@Injectable()
export class DevOtpDeliveryService extends OtpDeliveryService {
  private readonly logger = new Logger(DevOtpDeliveryService.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  override async send(type: IdentifierType, identifier: string, otp: string): Promise<void> {
    const app = this.config.getOrThrow<AppConfig>('app');
    const otpCfg = this.config.getOrThrow<OtpConfig>('otp');
    const masked = maskIdentifier(type, identifier);

    if (app.isProduction) {
      // TODO: integrate SES (email) and SNS/Twilio (SMS) providers.
      throw new Error('No OTP delivery provider configured');
    }
    if (otpCfg.devEcho) {
      process.stdout.write(`[DEV ONLY] OTP for ${masked}: ${otp}\n`);
      return;
    }
    this.logger.warn(
      { identifierType: type, identifier: masked },
      'No OTP delivery provider configured; code was not delivered (enable OTP_DEV_ECHO in development)',
    );
  }
}
