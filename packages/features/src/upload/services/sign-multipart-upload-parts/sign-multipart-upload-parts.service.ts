import { logError, trackedResult } from '@borradh-workspace/observability';
import type {
  getOrgAssetsBucket as GetOrgAssetsBucketFn,
  getPresignedMultipartUploadPartUrl as GetPresignedMultipartUploadPartUrlFn,
  getPublicAssetsBucket as GetPublicAssetsBucketFn,
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
  type SignMultipartUploadPartsInput,
  signMultipartUploadPartsSchema,
} from './sign-multipart-upload-parts.schema.js';

export interface SignMultipartStorageDeps {
  getOrgAssetsBucket: typeof GetOrgAssetsBucketFn;
  getPublicAssetsBucket: typeof GetPublicAssetsBucketFn;
  getPresignedMultipartUploadPartUrl: typeof GetPresignedMultipartUploadPartUrlFn;
}

export interface SignMultipartUploadPartsResult {
  parts: Array<{
    partNumber: number;
    url: string;
  }>;
  expiresIn: number;
}

const signMultipartUploadPartsImpl = async (
  storage: SignMultipartStorageDeps,
  input: SignMultipartUploadPartsInput
): Promise<Result<SignMultipartUploadPartsResult>> => {
  const parsed = signMultipartUploadPartsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { key, uploadId, type, userId, organizationId } = parsed.data;
  const purpose = parsed.data.purpose ?? 'org-asset';
  const expiresIn = parsed.data.expiresIn ?? 3600;

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

  try {
    const uniquePartNumbers = [...new Set(parsed.data.partNumbers)].sort(
      (a, b) => a - b
    );
    const parts = await Promise.all(
      uniquePartNumbers.map(async (partNumber) => ({
        partNumber,
        url: await storage.getPresignedMultipartUploadPartUrl({
          bucket,
          key,
          uploadId,
          partNumber,
          expiresIn,
        }),
      }))
    );

    return ok({ parts, expiresIn });
  } catch (error) {
    logError('upload.signMultipartUploadParts', error, { feature: 'upload' });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to sign multipart upload parts'
      )
    );
  }
};

export const signMultipartUploadParts = (
  storage: SignMultipartStorageDeps,
  input: SignMultipartUploadPartsInput
) =>
  trackedResult(
    'upload.signMultipartUploadParts',
    () => signMultipartUploadPartsImpl(storage, input),
    {
      properties: {
        type: input.type,
        purpose: input.purpose,
        userId: input.userId,
        partCount: input.partNumbers.length,
        feature_flag_key: 'rollout-resumable-uploads',
      },
    }
  );
