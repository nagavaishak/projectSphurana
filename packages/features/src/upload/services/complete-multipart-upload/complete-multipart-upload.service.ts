import { logError, trackedResult } from '@borradh-workspace/observability';
import type {
  completeMultipartUpload as CompleteMultipartUploadFn,
  getOrgAssetsBucket as GetOrgAssetsBucketFn,
  getPublicAssetsBucket as GetPublicAssetsBucketFn,
  getS3Region as GetS3RegionFn,
} from '@borradh-workspace/storage';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { isUploadKeyAllowed } from '../_shared/upload-helpers.js';
import {
  type CompleteMultipartUploadInput,
  completeMultipartUploadSchema,
} from './complete-multipart-upload.schema.js';

export interface CompleteMultipartStorageDeps {
  getOrgAssetsBucket: typeof GetOrgAssetsBucketFn;
  getPublicAssetsBucket: typeof GetPublicAssetsBucketFn;
  getS3Region: typeof GetS3RegionFn;
  completeMultipartUpload: typeof CompleteMultipartUploadFn;
}

export interface CompleteMultipartUploadResult {
  key: string;
  bucket: string;
  region: string;
  isPublic: boolean;
  publicUrl: string | undefined;
  etag: string | undefined;
}

const completeMultipartUploadImpl = async (
  storage: CompleteMultipartStorageDeps,
  input: CompleteMultipartUploadInput
): Promise<Result<CompleteMultipartUploadResult>> => {
  const parsed = completeMultipartUploadSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { key, uploadId, type, userId, organizationId } = parsed.data;
  const purpose = parsed.data.purpose ?? 'org-asset';

  if (
    !isUploadKeyAllowed({
      key,
      type,
      purpose,
      userId,
      organizationId,
    })
  ) {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        'Upload key is not allowed for this user'
      )
    );
  }

  const bucket =
    purpose === 'profile'
      ? storage.getPublicAssetsBucket()
      : storage.getOrgAssetsBucket();
  const region = storage.getS3Region();
  const isPublic = purpose === 'profile';

  try {
    const result = await storage.completeMultipartUpload({
      bucket,
      key,
      uploadId,
      parts: parsed.data.parts,
    });
    const publicUrl = isPublic
      ? `https://${bucket}.s3.${region}.amazonaws.com/${key}`
      : undefined;

    return ok({
      key,
      bucket,
      region,
      isPublic,
      publicUrl,
      etag: result.etag,
    });
  } catch (error) {
    logError('upload.completeMultipartUpload', error, { feature: 'upload' });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to complete multipart upload'
      )
    );
  }
};

export const completeMultipartUpload = (
  storage: CompleteMultipartStorageDeps,
  input: CompleteMultipartUploadInput
) =>
  trackedResult(
    'upload.completeMultipartUpload',
    () => completeMultipartUploadImpl(storage, input),
    {
      properties: {
        type: input.type,
        purpose: input.purpose,
        userId: input.userId,
        partCount: input.parts.length,
        feature_flag_key: 'rollout-resumable-uploads',
      },
    }
  );
