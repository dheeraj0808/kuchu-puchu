# Infrastructure checklist (before deployment)

Settings the code relies on but cannot enforce itself. Each item names the module that depends on it. Tick it in every environment (staging, production) before that environment takes real users.

## S3 private bucket (`S3_BUCKET_PRIVATE`)

Used by M07 data exports (`exports/<requestId>.zip`). M12 media will reuse the same `StorageProvider`. Guide S11: S3 buckets are private with Block Public Access, and data is encrypted at rest.

| # | Setting | Why | Done |
|---|---|---|---|
| 1 | **Block Public Access**: all four settings on, at the bucket and the account level | Exports hold a user's full email, phone, profile and dates. They are only ever reached through 15-minute presigned URLs. | [ ] |
| 2 | **Default encryption**: SSE-S3 (AES-256) or SSE-KMS, with a bucket policy that denies `s3:PutObject` without `x-amz-server-side-encryption` | The code sends `ServerSideEncryption: AES256` on every put; the default and the policy catch anything that does not | [ ] |
| 3 | **TLS-only policy**: deny every request where `aws:SecureTransport` is `false` | Presigned URLs and API calls must never travel in clear text | [ ] |
| 4 | **Lifecycle rule**: expire objects with prefix `exports/` after **2 days** (and abort incomplete multipart uploads after 1 day) | Backstop for the hourly expiry job: an export is downloadable for 24 h, then the job deletes it. If the job or a purge ever fails, S3 still removes the file. | [ ] |
| 5 | **IAM role of the API and worker**: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on `arn:aws:s3:::<bucket>/exports/*` only; no `s3:ListBucket`, no wildcard bucket | Least privilege. Credentials come from the role, never from keys (Appendix D). | [ ] |
| 6 | **Versioning off** for this bucket, or a lifecycle rule that also expires noncurrent versions of `exports/` after 2 days | With versioning on, a delete only adds a marker and the export would survive | [ ] |
| 7 | **Access logging or CloudTrail data events** on the bucket | Investigations: who downloaded which export (the app audits each URL it hands out as `account.data_export_url_issued`) | [ ] |
| 8 | Region matches `AWS_REGION`; `S3_BUCKET_PRIVATE` set in the environment | The app refuses to boot in production without both | [ ] |

## Redis

| # | Setting | Why | Done |
|---|---|---|---|
| 1 | Redis **6.2 or later** (7 recommended) | `GETDEL` (M07 deletion email) and `TIME` before a write in Lua (M06 sliding windows; needs 5+) | [ ] |
| 2 | TLS (`rediss://`, `REDIS_TLS=true`) and AUTH, private subnet only | Holds session state, rate-limit counters and, sealed, deletion confirmation addresses for up to 24 h | [ ] |

## MySQL

| # | Setting | Why | Done |
|---|---|---|---|
| 1 | `binlog_format = ROW` (MySQL 8 default) | The M07 session scrub uses `UUID()` in an `UPDATE`, which is unsafe under statement-based replication | [ ] |
| 2 | Encryption at rest and automated backups | Guide S11 | [ ] |

When a later module adds infrastructure it depends on (CloudFront for M12, FCM for M20, store webhooks for M21), add a section here.
