import { logError, trackedResult } from '@borradh-workspace/observability';
import type {
  getOrgAssetsBucket as GetOrgAssetsBucketFn,
  getPresignedDownloadUrl as GetPresignedDownloadUrlFn,
  getPublicAssetsBucket as GetPublicAssetsBucketFn,
} from '@borradh-workspace/storage';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GeneratePresignedDownloadUrlInput,
  generatePresignedDownloadUrlSchema,
} from './generate-presigned-download-url.schema.js';

export interface DownloadStorageDeps {
  getOrgAssetsBucket: typeof GetOrgAssetsBucketFn;
  getPublicAssetsBucket: typeof GetPublicAssetsBucketFn;
  getPresignedDownloadUrl: typeof GetPresignedDownloadUrlFn;
}

export interface PresignedDownloadUrlResult {
  url: string;
  key: string;
  bucket: string;
  expiresIn: number;
}

const generatePresignedDownloadUrlImpl = async (
  storage: DownloadStorageDeps,
  input: GeneratePresignedDownloadUrlInput
): Promise<Result<PresignedDownloadUrlResult>> => {
  const parsed = generatePresignedDownloadUrlSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { key, userId, organizationId } = parsed.data;
  const expiresIn = parsed.data.expiresIn ?? 3600;
  const bucket = parsed.data.bucket ?? storage.getOrgAssetsBucket();
  const orgAssetsBucket = storage.getOrgAssetsBucket();
  const publicAssetsBucket = storage.getPublicAssetsBucket();

  // Bucket allowlist: only mint presigned URLs for buckets that have an
  // explicit scoping/authorization branch below. Reject any other bucket so
  // an unexpected/unknown bucket can never be downloaded without scoping.
  const allowedBuckets = new Set([orgAssetsBucket, publicAssetsBucket]);
  if (!allowedBuckets.has(bucket)) {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        'You do not have access to this bucket'
      )
    );
  }

  // Authorization: verify the requested file belongs to the user's context
  if (bucket === orgAssetsBucket) {
    if (!organizationId) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'No active organization selected'
        )
      );
    }
    if (!key.startsWith(`${organizationId}/`)) {
      return err(
        new FeatureError(
          ErrorCodes.FORBIDDEN,
          'You do not have access to this file'
        )
      );
    }
  } else if (bucket === publicAssetsBucket) {
    if (!key.includes(`/${userId}/`)) {
      return err(
        new FeatureError(
          ErrorCodes.FORBIDDEN,
          'You do not have access to this file'
        )
      );
    }
  }

  try {
    const url = await storage.getPresignedDownloadUrl({
      bucket,
      key,
      expiresIn,
    });

    return ok({ url, key, bucket, expiresIn });
  } catch (error) {
    logError('upload.generatePresignedDownloadUrl', error, {
      feature: 'upload',
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to generate download URL'
      )
    );
  }
};

export const generatePresignedDownloadUrl = (
  storage: DownloadStorageDeps,
  input: GeneratePresignedDownloadUrlInput
) =>
  trackedResult(
    'upload.generatePresignedDownloadUrl',
    () => generatePresignedDownloadUrlImpl(storage, input),
    {
      properties: { key: input.key, userId: input.userId },
    }
  );
