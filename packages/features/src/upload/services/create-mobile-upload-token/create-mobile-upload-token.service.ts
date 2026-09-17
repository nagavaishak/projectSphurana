import { randomUUID } from 'node:crypto';
import { logError, trackedResult } from '@borradh-workspace/observability';
import type { getOrgAssetsBucket as GetOrgAssetsBucketFn } from '@borradh-workspace/storage';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CreateMobileUploadTokenInput,
  createMobileUploadTokenSchema,
} from './create-mobile-upload-token.schema.js';

/** Redis key prefixes and TTL for mobile upload tokens */
export const MOBILE_UPLOAD_TOKEN_PREFIX = 'upload:';
export const MOBILE_UPLOAD_STATUS_PREFIX = 'upload-status:';
export const MOBILE_UPLOAD_TOKEN_TTL = 900; // 15 minutes
export const MOBILE_UPLOAD_STATUS_TTL = 3600; // 1 hour

export interface MobileUploadTokenData {
  videoId: string;
  organizationId: string;
  userId: string;
  bucket: string;
  key: string;
  status: 'pending' | 'completed';
  url?: string;
  // Teleprompter script so the auth-free record screen can render without an
  // authenticated video fetch. Optional for backward compatibility.
  scriptText?: string;
}

export interface RedisDeps {
  set(key: string, value: string, mode: string, ttl: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  ttl(key: string): Promise<number>;
}

export interface MobileStorageDeps {
  getOrgAssetsBucket: typeof GetOrgAssetsBucketFn;
}

export interface CreateMobileUploadTokenResult {
  token: string;
  deepLinkUrl: string;
  expiresIn: number;
}

const createMobileUploadTokenImpl = async (
  redis: RedisDeps,
  storage: MobileStorageDeps,
  input: CreateMobileUploadTokenInput
): Promise<Result<CreateMobileUploadTokenResult>> => {
  const parsed = createMobileUploadTokenSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { videoId, userId, organizationId, scriptText } = parsed.data;
  const token = randomUUID();
  const bucket = storage.getOrgAssetsBucket();
  const timestamp = Date.now();
  const randomId = randomUUID().split('-')[0];
  const key = `${organizationId}/videos/${userId}/${timestamp}-${randomId}.mp4`;

  const tokenData: MobileUploadTokenData = {
    videoId,
    organizationId,
    userId,
    bucket,
    key,
    status: 'pending',
    ...(scriptText ? { scriptText } : {}),
  };

  try {
    await redis.set(
      `${MOBILE_UPLOAD_TOKEN_PREFIX}${token}`,
      JSON.stringify(tokenData),
      'EX',
      MOBILE_UPLOAD_TOKEN_TTL
    );
    await redis.set(
      `${MOBILE_UPLOAD_STATUS_PREFIX}${videoId}`,
      JSON.stringify({ status: 'pending', token }),
      'EX',
      MOBILE_UPLOAD_TOKEN_TTL
    );

    const deepLinkUrl = `borradh://upload?token=${token}`;

    return ok({ token, deepLinkUrl, expiresIn: MOBILE_UPLOAD_TOKEN_TTL });
  } catch (error) {
    logError('upload.createMobileUploadToken', error, { feature: 'upload' });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create upload token'
      )
    );
  }
};

export const createMobileUploadToken = (
  redis: RedisDeps,
  storage: MobileStorageDeps,
  input: CreateMobileUploadTokenInput
) =>
  trackedResult(
    'upload.createMobileUploadToken',
    () => createMobileUploadTokenImpl(redis, storage, input),
    {
      properties: { videoId: input.videoId, userId: input.userId },
    }
  );
