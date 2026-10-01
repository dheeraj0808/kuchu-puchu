import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { LocalStorageProvider } from './local-storage.provider';
import { S3StorageProvider } from './s3-storage.provider';
import { createStorageProvider } from './storage.module';

describe('storage adapters', () => {
  it('S3 when AWS_REGION and S3_BUCKET_PRIVATE are set, else the local fake', () => {
    expect(createStorageProvider({ region: 'ap-south-1', privateBucket: 'kp-private', localStorageDir: undefined })).toBeInstanceOf(S3StorageProvider);
    expect(createStorageProvider({ region: '', privateBucket: undefined, localStorageDir: undefined })).toBeInstanceOf(LocalStorageProvider);
  });

  it('local fake: put, read, delete (idempotent); rejects keys that escape its root', async () => {
    const storage = new LocalStorageProvider(mkdtempSync(join(tmpdir(), 'kp-storage-')));
    await storage.put({ bucket: 'private', key: 'exports/a.zip', body: Buffer.from('zip'), contentType: 'application/zip' });
    expect((await storage.read('private', 'exports/a.zip'))?.toString()).toBe('zip');
    await storage.delete('private', 'exports/a.zip');
    await storage.delete('private', 'exports/a.zip');
    expect(await storage.read('private', 'exports/a.zip')).toBeNull();
    for (const key of ['../x', 'exports/../../x', '/etc/passwd', 'Exports/A']) {
      await expect(storage.put({ bucket: 'private', key, body: Buffer.from(''), contentType: 'x' })).rejects.toThrow('Invalid storage key');
    }
  });

  it('local fake: every presigned URL is different and carries its expiry', async () => {
    const storage = new LocalStorageProvider(mkdtempSync(join(tmpdir(), 'kp-storage-')));
    const a = await storage.presignGet('private', 'exports/a.zip', 900);
    const b = await storage.presignGet('private', 'exports/a.zip', 900);
    expect(a).not.toBe(b);
    expect(Number(new URL(a).searchParams.get('expires'))).toBeGreaterThan(Date.now() / 1000 + 890);
  });

  it('S3: SSE on put, delete by key, presigned GET valid for the TTL', async () => {
    const send = jest.fn().mockResolvedValue({});
    const client = { send, config: {} } as unknown as S3Client;
    const s3 = new S3StorageProvider('ap-south-1', { private: 'kp-private' }, client);
    await s3.put({ bucket: 'private', key: 'exports/a.zip', body: Buffer.from('z'), contentType: 'application/zip' });
    const put = send.mock.calls[0][0] as PutObjectCommand;
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toMatchObject({ Bucket: 'kp-private', Key: 'exports/a.zip', ServerSideEncryption: 'AES256' });
    await s3.delete('private', 'exports/a.zip');
    expect((send.mock.calls[1][0] as DeleteObjectCommand).input).toEqual({ Bucket: 'kp-private', Key: 'exports/a.zip' });

    const real = new S3StorageProvider('ap-south-1', { private: 'kp-private' }, new S3Client({
      region: 'ap-south-1',
      credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret-example' },
    }));
    const url = new URL(await real.presignGet('private', 'exports/a.zip', 900, 'kuchu-puchu-export.zip'));
    expect(url.hostname).toContain('kp-private');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('response-content-disposition')).toBe('attachment; filename="kuchu-puchu-export.zip"');
  });
});
