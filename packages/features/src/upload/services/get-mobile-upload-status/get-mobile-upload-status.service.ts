import {
  MOBILE_UPLOAD_STATUS_PREFIX,
  type RedisDeps,
} from '../create-mobile-upload-token/index.js';
import {
  type GetMobileUploadStatusInput,
  getMobileUploadStatusSchema,
} from './get-mobile-upload-status.schema.js';

export interface MobileUploadStatus {
  status: 'pending' | 'completed';
  url?: string;
  token?: string;
}

export const getMobileUploadStatus = async (
  redis: RedisDeps,
  input: GetMobileUploadStatusInput
): Promise<MobileUploadStatus> => {
  const parsed = getMobileUploadStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'pending' };
  }

  try {
    const raw = await redis.get(
      `${MOBILE_UPLOAD_STATUS_PREFIX}${parsed.data.videoId}`
    );

    if (!raw) {
      return { status: 'pending' };
    }

    return JSON.parse(raw) as MobileUploadStatus;
  } catch {
    // Fail open — return pending if Redis is unavailable
    return { status: 'pending' };
  }
};
