#!/bin/sh
# Private buckets for M12 photos and M11 selfies (guide S6, S11): no public access.
set -eu
for bucket in kuchu-puchu-media-local kuchu-puchu-private-local; do
  awslocal s3api head-bucket --bucket "$bucket" 2>/dev/null || awslocal s3 mb "s3://$bucket"
  awslocal s3api put-public-access-block --bucket "$bucket" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
done
