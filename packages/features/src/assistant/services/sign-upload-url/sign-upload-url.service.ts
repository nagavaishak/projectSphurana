import { storageEnv } from '@borradh-workspace/env/storage';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  getPresignedDownloadUrl,
  getPresignedUploadUrl,
} from '@borradh-workspace/storage';
import { nanoid } from 'nanoid';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  ASSISTANT_UPLOAD_MAX_BYTES,
  type AssistantUploadMimeType,
  type SignUploadUrlInput,
  signUploadUrlSchema,
} from './sign-upload-url.schema.js';

const UPLOAD_TTL_SECONDS = 5 * 60; // 5 min — enough for a typical upload, not so long that a stolen URL is useful
const DOWNLOAD_TTL_SECONDS = 60 * 60; // 1 hr — long enough to round-trip a multi-tool model loop

const MIME_TO_EXT: Record<AssistantUploadMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface SignUploadUrlOutput {
  uploadUrl: string;
  downloadUrl: string;
  s3Key: string;
  bucket: string;
  expiresAt: Date;
  contentLengthMax: number;
  mimeType: AssistantUploadMimeType;
}

/**
 * Build the S3 key for an assistant upload. The key is namespaced by
 * organization + conversation so cross-tenant access is impossible at the
 * storage layer (the IAM policy gates the API task to this bucket only;
 * the signed URL is the access boundary for the browser).
 */
const buildS3Key = (
  organizationId: string,
  conversationId: string,
  mimeType: AssistantUploadMimeType
): string => {
  const ext = MIME_TO_EXT[mimeType];
  const id = nanoid();
  return `org/${organizationId}/conv/${conversationId}/upload/${id}.${ext}`;
};

const signUploadUrlImpl = async (
  input: SignUploadUrlInput
): Promise<Result<SignUploadUrlOutput>> => {
  const parsed = signUploadUrlSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const bucket = storageEnv.S3_ASSISTANT_UPLOADS_BUCKET;
  if (!bucket) {
    // Fail loudly rather than silently fall back to another bucket; cross-org
    // isolation depends on this bucket being correctly configured. The sign
    // endpoint will surface as 500 to the client.
    logError(
      'assistant.signUploadUrl',
      new Error('S3_ASSISTANT_UPLOADS_BUCKET is not configured'),
      {
        feature: 'assistant',
        extra: { organizationId: parsed.data.organizationId },
      }
    );
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Image attachments are not configured for this environment'
      )
    );
  }

  const { organizationId, conversationId, mimeType } = parsed.data;
  const s3Key = buildS3Key(organizationId, conversationId, mimeType);
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000);

  try {
    const [uploadUrl, downloadUrl] = await Promise.all([
      getPresignedUploadUrl({
        bucket,
        key: s3Key,
        contentType: mimeType,
        expiresIn: UPLOAD_TTL_SECONDS,
      }),
      getPresignedDownloadUrl({
        bucket,
        key: s3Key,
        expiresIn: DOWNLOAD_TTL_SECONDS,
      }),
    ]);

    return ok({
      uploadUrl,
      downloadUrl,
      s3Key,
      bucket,
      expiresAt,
      contentLengthMax: ASSISTANT_UPLOAD_MAX_BYTES,
      mimeType,
    });
  } catch (error) {
    logError('assistant.signUploadUrl', error, {
      feature: 'assistant',
      extra: { organizationId, conversationId, mimeType, s3Key },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to sign upload URL')
    );
  }
};

export const signUploadUrl = (input: SignUploadUrlInput) =>
  trackedResult('assistant.signUploadUrl', () => signUploadUrlImpl(input), {
    properties: {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      mimeType: input.mimeType,
    },
  });

export type SignUploadUrlResult = Awaited<ReturnType<typeof signUploadUrl>>;
