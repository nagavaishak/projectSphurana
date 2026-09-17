import { logError, trackedResult } from '@borradh-workspace/observability';
import type {
  createMultipartUpload as CreateMultipartUploadFn,
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
import {
  generateUploadKey,
  validateUploadContentType,
} from '../_shared/upload-helpers.js';
import {
  type InitiateMultipartUploadInput,
  initiateMultipartUploadSchema,
} from './initiate-multipart-upload.schema.js';

export interface InitiateMultipartStorageDeps {
  getOrgAssetsBucket: typeof GetOrgAssetsBucketFn;
  getPublicAssetsBucket: typeof GetPublicAssetsBucketFn;
  getS3Region: typeof GetS3RegionFn;
  createMultipartUpload: typeof CreateMultipartUploadFn;
}

export interface InitiateMultipartUploadResult {
  uploadId: string;
  key: string;
  bucket: string;
  region: string;
  isPublic: boolean;
  publicUrl: string | undefined;
  partSize: number;
  expiresIn: number;
}

const DEFAULT_PART_SIZE = 8 * 1024 * 1024;
const PART_URL_EXPIRES_IN_SECONDS = 3600;

const initiateMultipartUploadImpl = async (
  storage: InitiateMultipartStorageDeps,
  input: InitiateMultipartUploadInput
): Promise<Result<InitiateMultipartUploadResult>> => {
  const parsed = initiateMultipartUploadSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { filename, contentType, type, userId, organizationId } = parsed.data;
  const purpose = parsed.data.purpose ?? 'org-asset';
  const partSize = parsed.data.partSize ?? DEFAULT_PART_SIZE;

  if (purpose === 'org-asset' && !organizationId) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'No active organization selected for org asset upload'
      )
    );
  }

  const contentTypeError = validateUploadContentType(type, contentType);
  if (contentTypeError) {
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, contentTypeError));
  }

  const bucket =
    purpose === 'profile'
      ? storage.getPublicAssetsBucket()
      : storage.getOrgAssetsBucket();
  const region = storage.getS3Region();
  const isPublic = purpose === 'profile';
  const key = generateUploadKey(
    userId,
    type,
    filename,
    purpose,
    organizationId
  );

  try {
    const { uploadId } = await storage.createMultipartUpload({
      bucket,
      key,
      contentType,
    });
    const publicUrl = isPublic
      ? `https://${bucket}.s3.${region}.amazonaws.com/${key}`
      : undefined;

    return ok({
      uploadId,
      key,
      bucket,
      region,
      isPublic,
      publicUrl,
      partSize,
      expiresIn: PART_URL_EXPIRES_IN_SECONDS,
    });
  } catch (error) {
    logError('upload.initiateMultipartUpload', error, { feature: 'upload' });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to initiate multipart upload'
      )
    );
  }
};

export const initiateMultipartUpload = (
  storage: InitiateMultipartStorageDeps,
  input: InitiateMultipartUploadInput
) =>
  trackedResult(
    'upload.initiateMultipartUpload',
    () => initiateMultipartUploadImpl(storage, input),
    {
      properties: {
        type: input.type,
        purpose: input.purpose,
        userId: input.userId,
        feature_flag_key: 'rollout-resumable-uploads',
      },
    }
  );
