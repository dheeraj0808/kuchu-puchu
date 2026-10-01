import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { assertStorageKey, type PutObjectInput, type StorageBucket, StorageProvider } from './storage.provider';

/** S3 with IAM-role credentials. Objects are written with SSE (S3-managed keys); the bucket blocks public access (S11). */
export class S3StorageProvider extends StorageProvider {
  private readonly client: S3Client;

  constructor(
    region: string,
    private readonly buckets: Record<StorageBucket, string>,
    client?: S3Client,
  ) {
    super();
    this.client = client ?? new S3Client({ region });
  }

  override async put(input: PutObjectInput): Promise<void> {
    assertStorageKey(input.key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.buckets[input.bucket],
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
  }

  override async delete(bucket: StorageBucket, key: string): Promise<void> {
    assertStorageKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.buckets[bucket], Key: key }));
  }

  override async presignGet(bucket: StorageBucket, key: string, ttlSeconds: number, downloadName?: string): Promise<string> {
    assertStorageKey(key);
    const command = new GetObjectCommand({
      Bucket: this.buckets[bucket],
      Key: key,
      ...(downloadName ? { ResponseContentDisposition: `attachment; filename="${downloadName.replace(/[^A-Za-z0-9._-]/g, '_')}"` } : {}),
    });
    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }
}
