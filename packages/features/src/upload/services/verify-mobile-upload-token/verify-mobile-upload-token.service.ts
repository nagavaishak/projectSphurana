import { logError, trackedResult } from '@borradh-workspace/observability';
import type { getPresignedUploadUrl as GetPresignedUploadUrlFn } from '@borradh-workspace/storage';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  MOBILE_UPLOAD_TOKEN_PREFIX,
  MOBILE_UPLOAD_TOKEN_TTL,
  type MobileUploadTokenData,
  type RedisDeps,
} from '../create-mobile-upload-token/index.js';
import {
  type VerifyMobileUploadTokenInput,
  verifyMobileUploadTokenSchema,
} from './verify-mobile-upload-token.schema.js';

export interface VerifyStorageDeps {
  getPresignedUploadUrl: typeof GetPresignedUploadUrlFn;
}

export interface VerifyMobileUploadTokenResult {
  uploadUrl: string;
  key: string;
  contentType: string;
  videoId: string;
  // Teleprompter script for the auth-free record screen (undefined for tokens
  // minted before script-carrying was added).
  scriptText?: string;
}

const verifyMobileUploadTokenImpl = async (
  redis: RedisDeps,
  storage: VerifyStorageDeps,
  input: VerifyMobileUploadTokenInput
): Promise<Result<VerifyMobileUploadTokenResult>> => {
  const parsed = verifyMobileUploadTokenSchema.safeParse(input);
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

    const uploadUrl = await storage.getPresignedUploadUrl({
      bucket: data.bucket,
      key: data.key,
      contentType: 'video/mp4',
      expiresIn: MOBILE_UPLOAD_TOKEN_TTL,
    });

    return ok({
      uploadUrl,
      key: data.key,
      contentType: 'video/mp4',
      videoId: data.videoId,
      scriptText: data.scriptText,
    });
  } catch (error) {
    if (error instanceof FeatureError) {
      return err(error);
    }
    logError('upload.verifyMobileUploadToken', error, { feature: 'upload' });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to verify upload token'
      )
    );
  }
};

export const verifyMobileUploadToken = (
  redis: RedisDeps,
  storage: VerifyStorageDeps,
  input: VerifyMobileUploadTokenInput
) =>
  trackedResult(
    'upload.verifyMobileUploadToken',
    () => verifyMobileUploadTokenImpl(redis, storage, input),
    {
      properties: { token: input.token },
      internalErrorsOnly: true,
    }
  );
