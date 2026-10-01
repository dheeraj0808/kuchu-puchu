import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Logger, PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { buildPinoHttpOptions } from '../../src/common/logging/logger.module';
import appConfig from '../../src/config/app.config';
import { EmailProvider } from '../../src/infra/email/email.provider';
import { FakeEmailProvider } from '../../src/infra/email/fake-email.provider';
import { FakeSmsProvider } from '../../src/infra/sms/fake-sms.provider';
import { SmsProvider } from '../../src/infra/sms/sms.provider';
import { captureStream, rememberSecret } from './log-capture';

/**
 * A fully configured app instance, as main.ts builds it, without listening on
 * a port. Logs go through the production pino options, at debug level, into
 * the suite-wide capture (log-scan.ts). Every code and identifier handed to
 * the fake SMS / email providers is remembered, so the scan can prove none of
 * them ever reached a log line.
 */
export async function createTestApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue({ pinoHttp: [{ ...buildPinoHttpOptions(appConfig()), level: 'debug', transport: undefined }, captureStream()] })
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  app.useLogger(app.get(Logger));
  watchFakes(app);
  await configureApp(app);
  return app;
}

export function fakeSms(app: NestExpressApplication): FakeSmsProvider {
  return app.get(SmsProvider) as FakeSmsProvider;
}

export function fakeEmail(app: NestExpressApplication): FakeEmailProvider {
  return app.get(EmailProvider) as FakeEmailProvider;
}

function watchFakes(app: NestExpressApplication): void {
  const sms = fakeSms(app);
  const sendOtp = sms.sendOtp.bind(sms);
  sms.sendOtp = async (message) => {
    rememberSecret(message.code);
    rememberSecret(message.to);
    // Also the national form (e.g. 9812345678 for +91…), in case something logged it without the prefix.
    if (message.to.startsWith('+91')) rememberSecret(message.to.slice(3));
    return sendOtp(message);
  };
  const email = fakeEmail(app);
  const send = email.send.bind(email);
  email.send = async (message) => {
    rememberSecret(message.to);
    for (const code of message.text.match(/\b\d{4,10}\b/g) ?? []) rememberSecret(code);
    return send(message);
  };
}
