/** Where a stored object lives. Only private storage exists so far (M12 adds media). */
export type StorageBucket = 'private';

export interface PutObjectInput {
  bucket: StorageBucket;
  /** e.g. exports/<requestId>.zip. Never contains user data. */
  key: string;
  body: Buffer;
  contentType: string;
}

/**
 * Port for object storage (guide §4.4): S3 in production, a local-filesystem
 * fake in development and tests. Keys and URLs are never logged with user data.
 */
export abstract class StorageProvider {
  abstract put(input: PutObjectInput): Promise<void>;

  /** Idempotent: deleting a missing object succeeds. */
  abstract delete(bucket: StorageBucket, key: string): Promise<void>;

  /** A time-limited download URL. A new one on every call. */
  abstract presignGet(bucket: StorageBucket, key: string, ttlSeconds: number, downloadName?: string): Promise<string>;
}

export const STORAGE_KEY = /^[a-z0-9][a-z0-9/_.-]{0,199}$/;

export function assertStorageKey(key: string): void {
  if (!STORAGE_KEY.test(key) || key.includes('..')) throw new Error('Invalid storage key');
}
