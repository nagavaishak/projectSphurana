import { randomUUID } from 'node:crypto';
import type {
  UploadPurpose,
  UploadType,
} from '../generate-presigned-upload-url/generate-presigned-upload-url.schema.js';

export const IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

export const VIDEO_CONTENT_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
];

export function validateUploadContentType(
  type: UploadType,
  contentType: string
): string | null {
  if (type === 'image' && !IMAGE_CONTENT_TYPES.includes(contentType)) {
    return `Invalid content type for image upload. Allowed: ${IMAGE_CONTENT_TYPES.join(', ')}`;
  }
  if (type === 'video' && !VIDEO_CONTENT_TYPES.includes(contentType)) {
    return `Invalid content type for video upload. Allowed: ${VIDEO_CONTENT_TYPES.join(', ')}`;
  }
  return null;
}

/**
 * Derive a safe file extension from a user-supplied filename.
 *
 * The raw filename can contain path separators (`/`, `..`) or other
 * characters that would let an attacker influence the S3 key. We take only
 * the last path segment's extension, lowercase it, strip everything but
 * `[a-z0-9]`, cap its length, and fall back to a sane default if empty.
 */
export function safeExtension(filename: string, type: UploadType): string {
  const fallback = type === 'image' ? 'jpg' : 'mp4';
  const lastSegment = filename.split(/[/\\]/).pop() ?? '';
  const rawExt = lastSegment.includes('.') ? lastSegment.split('.').pop() : '';
  const cleaned = (rawExt ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 5);
  return cleaned || fallback;
}

export function generateUploadKey(
  userId: string,
  type: UploadType,
  filename: string,
  purpose: UploadPurpose,
  organizationId?: string
): string {
  const timestamp = Date.now();
  const randomId = randomUUID().split('-')[0];
  const extension = safeExtension(filename, type);
  const folder = type === 'image' ? 'images' : 'videos';

  if (purpose === 'org-asset' && organizationId) {
    return `${organizationId}/${folder}/${userId}/${timestamp}-${randomId}.${extension}`;
  }
  return `${folder}/${userId}/${timestamp}-${randomId}.${extension}`;
}

export function isUploadKeyAllowed(input: {
  key: string;
  type: UploadType;
  purpose: UploadPurpose;
  userId: string;
  organizationId?: string;
}): boolean {
  const folder = input.type === 'image' ? 'images' : 'videos';
  if (input.purpose === 'org-asset') {
    if (!input.organizationId) return false;
    return input.key.startsWith(
      `${input.organizationId}/${folder}/${input.userId}/`
    );
  }
  return input.key.startsWith(`${folder}/${input.userId}/`);
}
