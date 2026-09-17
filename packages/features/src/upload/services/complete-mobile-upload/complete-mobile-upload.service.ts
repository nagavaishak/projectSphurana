import { logError, trackedResult } from '@borradh-workspace/observability';
import type { getS3Region as GetS3RegionFn } from '@borradh-workspace/storage';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  MOBILE_UPLOAD_STATUS_PREFIX,
  MOBILE_UPLOAD_STATUS_TTL,
  MOBILE_UPLOAD_TOKEN_PREFIX,
  MOBILE_UPLOAD_TOKEN_TTL,
  type MobileUploadTokenData,
  type RedisDeps,
} from '../create-mobile-upload-token/index.js';
import {
  type CompleteMobileUploadInput,
  completeMobileUploadSchema,
} from './complete-mobile-upload.schema.js';

export interface CompleteStorageDeps {
  getS3Region: typeof GetS3RegionFn;
}

export interface CompleteMobileUploadResult {
  success: true;
  url: string;
}

const completeMobileUploadImpl = async (
  redis: RedisDeps,
  storage: CompleteStorageDeps,
  input: CompleteMobileUploadInput
): Promise<Result<CompleteMobileUploadResult>> => {
  const parsed = completeMobileUploadSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const raw = await redis.get(
      `${MOBILE_UPLOAD_TOKEN_PREFIX}${parsed.data.token}`
    );

    if (!raw) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          'Upload token is invalid or expired'
        )
      );
    }

    const data: MobileUploadTokenData = JSON.parse(raw);

    // Build CDN URL from the key
    const region = storage.getS3Region();
    const url = `https://${data.bucket}.s3.${region}.amazonaws.com/${data.key}`;

    // Update token data
    data.status = 'completed';
    data.url = url;

    // Get remaining TTL to preserve it
    const ttl = await redis.ttl(
      `${MOBILE_UPLOAD_TOKEN_PREFIX}${parsed.data.token}`
    );
    const tokenTtl = ttl > 0 ? ttl : MOBILE_UPLOAD_TOKEN_TTL;

    await redis.set(
      `${MOBILE_UPLOAD_TOKEN_PREFIX}${parsed.data.token}`,
      JSON.stringify(data),
      'EX',
      tokenTtl
    );

    // Update status key with extended TTL for polling
    await redis.set(
      `${MOBILE_UPLOAD_STATUS_PREFIX}${data.videoId}`,
      JSON.stringify({ status: 'completed', url }),
      'EX',
      MOBILE_UPLOAD_STATUS_TTL
    );

    return ok({ success: true as const, url });
  } catch (error) {
    if (error instanceof FeatureError) {
      return err(error);
    }
    logError('upload.completeMobileUpload', error, { feature: 'upload' });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to complete upload')
    );
  }
};

export const completeMobileUpload = (
  redis: RedisDeps,
  storage: CompleteStorageDeps,
  input: CompleteMobileUploadInput
) =>
  trackedResult(
    'upload.completeMobileUpload',
    () => completeMobileUploadImpl(redis, storage, input),
    {
      properties: { token: input.token },
    }
  );
