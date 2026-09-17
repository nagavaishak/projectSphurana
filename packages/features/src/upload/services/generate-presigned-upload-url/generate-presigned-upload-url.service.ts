import { randomUUID } from 'node:crypto';
import { logError, trackedResult } from '@borradh-workspace/observability';
import type {
  getOrgAssetsBucket as GetOrgAssetsBucketFn,
  getPresignedUploadUrl as GetPresignedUploadUrlFn,
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
  safeExtension,
  validateUploadContentType,
} from '../_shared/upload-helpers.js';
import {
  type GeneratePresignedUploadUrlInput,
  PATIENT_DOCUMENT_CONTENT_TYPES,
  generatePresignedUploadUrlSchema,
} from './generate-presigned-upload-url.schema.js';

export interface StorageDeps {
  getOrgAssetsBucket: typeof GetOrgAssetsBucketFn;
  getPublicAssetsBucket: typeof GetPublicAssetsBucketFn;
  getS3Region: typeof GetS3RegionFn;
  getPresignedUploadUrl: typeof GetPresignedUploadUrlFn;
}

export interface PresignedUploadUrlResult {
  url: string;
  key: string;
  bucket: string;
  region: string;
  isPublic: boolean;
  publicUrl: string | undefined;
  expiresIn: number;
}

/**
 * Extension for a patient-document key. `safeExtension`'s fallback is
 * type-based (jpg/mp4), which is wrong for an extension-less PDF — here the
 * validated content type is the better fallback.
 */
const PATIENT_DOCUMENT_MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
};

function patientDocumentExtension(
  filename: string,
  contentType: string
): string {
  const fromName = safeExtension(filename, 'image');
  // safeExtension falls back to 'jpg' only when the filename had no usable
  // extension — prefer the mime-derived one in that case.
  const hadExtension = /\.[a-zA-Z0-9]+$/.test(
    filename.split(/[/\\]/).pop() ?? ''
  );
  if (hadExtension) return fromName;
  return PATIENT_DOCUMENT_MIME_EXTENSIONS[contentType] ?? fromName;
}

/**
 * Key prefix for patient documents in the PRIVATE org-assets bucket
 * (never public-assets — these are clinical files). Mirrors the org-asset
 * `{organizationId}/...` convention but under a dedicated root so vault
 * files can never be confused with marketing media.
 */
export function buildPatientDocumentKey(
  organizationId: string,
  leadId: string,
  filename: string,
  contentType: string
): string {
  const timestamp = Date.now();
  const randomId = randomUUID().split('-')[0];
  const extension = patientDocumentExtension(filename, contentType);
  return `patient-documents/${organizationId}/${leadId}/${timestamp}-${randomId}.${extension}`;
}

const generatePresignedUploadUrlImpl = async (
  storage: StorageDeps,
  input: GeneratePresignedUploadUrlInput
): Promise<Result<PresignedUploadUrlResult>> => {
  const parsed = generatePresignedUploadUrlSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    filename,
    contentType,
    type,
    userId,
    organizationId,
    leadId,
    contentLength,
  } = parsed.data;
  const purpose = parsed.data.purpose ?? 'org-asset';
  const expiresIn = parsed.data.expiresIn ?? 3600;

  // Validate organization is set for org assets
  if (purpose === 'org-asset' && !organizationId) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'No active organization selected for org asset upload'
      )
    );
  }

  // Patient documents need both scoping ids for the key prefix.
  if (purpose === 'patient-document' && (!organizationId || !leadId)) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'organizationId and leadId are required for patient document uploads'
      )
    );
  }

  // Validate content type. Patient documents allow images + PDF (not the
  // image/video split the other purposes use), so they get their own list.
  if (purpose === 'patient-document') {
    if (
      !(PATIENT_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(
        contentType
      )
    ) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          `Invalid content type for patient document upload. Allowed: ${PATIENT_DOCUMENT_CONTENT_TYPES.join(', ')}`
        )
      );
    }
  } else {
    const contentTypeError = validateUploadContentType(type, contentType);
    if (contentTypeError) {
      return err(
        new FeatureError(ErrorCodes.VALIDATION_ERROR, contentTypeError)
      );
    }
  }

  // Bucket routing: only 'profile' is public; org assets AND patient
  // documents live in the private org-assets bucket.
  const bucket =
    purpose === 'profile'
      ? storage.getPublicAssetsBucket()
      : storage.getOrgAssetsBucket();
  const region = storage.getS3Region();
  const isPublic = purpose === 'profile';

  const key =
    purpose === 'patient-document'
      ? // Both ids are guaranteed by the check above.
        buildPatientDocumentKey(
          organizationId as string,
          leadId as string,
          filename,
          contentType
        )
      : generateUploadKey(userId, type, filename, purpose, organizationId);

  try {
    const url = await storage.getPresignedUploadUrl({
      bucket,
      key,
      contentType,
      expiresIn,
      ...(contentLength !== undefined ? { contentLength } : {}),
    });

    const publicUrl = isPublic
      ? `https://${bucket}.s3.${region}.amazonaws.com/${key}`
      : undefined;

    return ok({ url, key, bucket, region, isPublic, publicUrl, expiresIn });
  } catch (error) {
    logError('upload.generatePresignedUploadUrl', error, { feature: 'upload' });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to generate upload URL'
      )
    );
  }
};

export const generatePresignedUploadUrl = (
  storage: StorageDeps,
  input: GeneratePresignedUploadUrlInput
) =>
  trackedResult(
    'upload.generatePresignedUploadUrl',
    () => generatePresignedUploadUrlImpl(storage, input),
    {
      properties: {
        type: input.type,
        purpose: input.purpose,
        userId: input.userId,
      },
    }
  );
