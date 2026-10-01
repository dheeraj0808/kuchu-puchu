import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { FaceProviderName } from '../../config/env.validation';
import type { VerificationConfig } from '../../config/verification.config';
import { FaceProvider } from './face.provider';
import { FakeFaceProvider } from './fake-face.provider';
import { RekognitionFaceProvider } from './rekognition-face.provider';

/** The adapter named by FACE_PROVIDER. Production refuses unset or "fake" in env validation. */
export function createFaceProvider(cfg: VerificationConfig): FaceProvider {
  if (cfg.faceProvider === FaceProviderName.Rekognition) return new RekognitionFaceProvider(cfg.awsRegion, cfg.providerTimeoutMs);
  return new FakeFaceProvider(cfg.fakeOutcome, cfg.sessionTtlSeconds);
}

@Global()
@Module({
  providers: [
    {
      provide: FaceProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService): FaceProvider => createFaceProvider(config.getOrThrow<VerificationConfig>('verification')),
    },
  ],
  exports: [FaceProvider],
})
export class FaceModule {}
