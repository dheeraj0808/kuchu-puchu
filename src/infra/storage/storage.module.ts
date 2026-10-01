import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AwsConfig } from '../../config/integrations.config';
import { LocalStorageProvider } from './local-storage.provider';
import { S3StorageProvider } from './s3-storage.provider';
import { StorageProvider } from './storage.provider';

/** S3 when AWS_REGION and S3_BUCKET_PRIVATE are set (required in production), otherwise the local fake. */
export function createStorageProvider(cfg: AwsConfig): StorageProvider {
  if (cfg.region && cfg.privateBucket) return new S3StorageProvider(cfg.region, { private: cfg.privateBucket });
  return new LocalStorageProvider(cfg.localStorageDir ?? join(tmpdir(), 'kuchu-puchu-storage'));
}

@Global()
@Module({
  providers: [
    {
      provide: StorageProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageProvider => createStorageProvider(config.getOrThrow<AwsConfig>('aws')),
    },
  ],
  exports: [StorageProvider],
})
export class StorageModule {}
