import { S3Client } from '@aws-sdk/client-s3';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { storageEnv } from '@borradh-workspace/env/storage';

type CredentialResolver = ReturnType<typeof fromNodeProviderChain>;

let s3Client: S3Client | null = null;

/**
 * The memoizing chain, rebuilt whenever it latches a failure. Held apart from
 * the client so a wedged chain can be dropped without discarding the client
 * (and its connection pool) too.
 */
let credentialChain: CredentialResolver | null = null;

/**
 * Resolve AWS credentials, caching them for their full lifetime so SSO is not
 * re-resolved on every request.
 *
 * The `catch` is load-bearing. `memoizeChain` in
 * `@aws-sdk/credential-provider-node` stores the in-flight resolution in an
 * `activeLock` promise and clears it ONLY from that promise's success
 * callback — there is no rejection handler. A failed resolution therefore
 * leaves a permanently-rejected promise behind, and every later call short-
 * circuits on `if (activeLock) await activeLock`, re-throwing the original
 * error forever. The process stays wedged even after the credentials are
 * repaired on disk.
 *
 * Locally that means one lapsed `aws sso login` breaks every direct-to-S3
 * feature (document imports, the patient-document vault, assets, graphics,
 * videos) for the life of the dev server, and re-authenticating does NOT fix
 * it — only a restart does. In deployed environments the same latch turns a
 * transient IMDS/STS blip into a permanent outage of every upload path.
 *
 * Dropping the chain on failure means the next call builds a fresh one and
 * re-reads the credential source. The failed call still fails; the one after
 * it recovers.
 *
 * Exported for `s3-client.spec.ts` only — deliberately NOT re-exported from
 * the package index. Callers want `getS3Client()`.
 */
export const resolveCredentials: CredentialResolver = async (props) => {
  credentialChain ??= fromNodeProviderChain({
    profile: storageEnv.AWS_PROFILE,
    // Cache credentials for their full lifetime
    ignoreCache: false,
  });

  try {
    return await credentialChain(props);
  } catch (error) {
    credentialChain = null;
    throw error;
  }
};

export function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: storageEnv.S3_REGION,
      credentials: resolveCredentials,
      // Only attach a checksum when the operation actually requires one. The
      // SDK default (WHEN_SUPPORTED, since @aws-sdk/client-s3 ~3.729) bakes an
      // x-amz-checksum-crc32 + x-amz-sdk-checksum-algorithm into presigned PUT
      // URLs. Browser uploads to those URLs then fail the S3 CORS preflight
      // (net::ERR_FAILED) because the extra checksum headers aren't part of the
      // signed/allowed set — silently breaking every direct-to-S3 asset upload.
      // WHEN_REQUIRED keeps checksums off plain PutObject presigns.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      ...(storageEnv.S3_ENDPOINT && { endpoint: storageEnv.S3_ENDPOINT }),
      ...(storageEnv.S3_FORCE_PATH_STYLE && {
        forcePathStyle: storageEnv.S3_FORCE_PATH_STYLE,
      }),
    });
  }
  return s3Client;
}

/**
 * Get the public assets bucket name (profile pictures, public images)
 */
export function getPublicAssetsBucket(): string {
  return storageEnv.S3_PUBLIC_ASSETS_BUCKET;
}

/**
 * Get the org assets bucket name (video creation, private uploads)
 */
export function getOrgAssetsBucket(): string {
  return storageEnv.S3_ORG_ASSETS_BUCKET;
}

/**
 * Get the canonical image-templates bucket name (content-addressed reference
 * PNGs). One bucket in the prod account; the publish step writes it.
 */
export function getImageTemplatesBucket(): string {
  const bucket = storageEnv.S3_IMAGE_TEMPLATES_BUCKET;
  if (!bucket) {
    throw new Error('S3_IMAGE_TEMPLATES_BUCKET is not configured');
  }
  return bucket;
}

/**
 * Get the public base URL for the canonical image-templates bucket. Reference
 * images are addressed as `${base}/<sha256>.png`. Same value in every env.
 */
export function getImageTemplatesPublicBaseUrl(): string {
  const url = storageEnv.IMAGE_TEMPLATES_PUBLIC_BASE_URL;
  if (!url) {
    throw new Error('IMAGE_TEMPLATES_PUBLIC_BASE_URL is not configured');
  }
  return url.replace(/\/$/, '');
}

/**
 * Get the S3 region
 */
export function getS3Region(): string {
  return storageEnv.S3_REGION;
}

/**
 * Get the analytics bucket name (Parquet snapshots for PostHog Data Warehouse)
 */
export function getAnalyticsBucket(): string {
  const bucket = storageEnv.S3_ANALYTICS_BUCKET;
  if (!bucket) {
    throw new Error('S3_ANALYTICS_BUCKET is not configured');
  }
  return bucket;
}

/**
 * @deprecated Use getPublicAssetsBucket() or getOrgAssetsBucket() instead
 */
export function getDefaultBucket(): string {
  // Fallback to legacy S3_BUCKET or public assets bucket
  return storageEnv.S3_BUCKET ?? storageEnv.S3_PUBLIC_ASSETS_BUCKET;
}
