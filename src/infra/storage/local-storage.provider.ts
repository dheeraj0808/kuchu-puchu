import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { assertStorageKey, type PutObjectInput, type StorageBucket, StorageProvider } from './storage.provider';

/**
 * Development and test double: files under `<root>/<bucket>/<key>`. URLs are
 * `local-storage://` links with an expiry and a signature, so code paths that
 * hand out links behave like S3's; nothing serves them.
 */
export class LocalStorageProvider extends StorageProvider {
  private readonly root: string;
  private readonly signingKey = randomBytes(32);

  constructor(root: string) {
    super();
    this.root = resolve(root);
  }

  override async put(input: PutObjectInput): Promise<void> {
    const path = this.pathOf(input.bucket, input.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.body);
  }

  override async delete(bucket: StorageBucket, key: string): Promise<void> {
    await rm(this.pathOf(bucket, key), { force: true });
  }

  override async presignGet(bucket: StorageBucket, key: string, ttlSeconds: number): Promise<string> {
    this.pathOf(bucket, key);
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const nonce = randomBytes(8).toString('hex');
    const sig = createHmac('sha256', this.signingKey).update(`${bucket}/${key}:${expires}:${nonce}`).digest('hex');
    return `local-storage://${bucket}/${key}?expires=${expires}&nonce=${nonce}&sig=${sig}`;
  }

  /** Tests and tools: the stored bytes, or null. */
  async read(bucket: StorageBucket, key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathOf(bucket, key));
    } catch {
      return null;
    }
  }

  private pathOf(bucket: StorageBucket, key: string): string {
    assertStorageKey(key);
    const path = resolve(join(this.root, bucket, key));
    if (!path.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return path;
  }
}
