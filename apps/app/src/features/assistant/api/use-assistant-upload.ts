import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';

/**
 * Image attachment upload (W-C11-frontend).
 *
 * Two-leg flow:
 *   1. POST /assistant/uploads/sign with { conversationId, mimeType }
 *      → { uploadUrl, downloadUrl, mimeType, expiresAt, contentLengthMax }
 *   2. PUT the file bytes directly to S3 with the matching Content-Type
 *
 * The signed upload URL is constrained server-side to the same Content-Type;
 * size + MIME are validated locally for fast UX feedback (server enforces
 * again — never trust the client). The download URL is short-lived (1 hr,
 * per W-C11-infra) and gets attached to the next outbound user message as a
 * `file` part with `mediaType: 'image/...'`. The backend converter
 * (`convert-to-anthropic-messages`) maps that to an Anthropic vision
 * `{ type: 'image', source: { type: 'url', url } }` content block.
 *
 * The signing endpoint requires a conversationId, so the caller must
 * lazy-create the conversation before the first upload (the composer does
 * this via its `ensureConversation` prop).
 *
 * Width/height are derived best-effort via `createImageBitmap` — useful for
 * inline rendering layout but not load-bearing; failures are silent.
 */

export const ASSISTANT_UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AssistantUploadMimeType =
  (typeof ASSISTANT_UPLOAD_MIME_TYPES)[number];

export const ASSISTANT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export interface AssistantUploadParams {
  file: File;
  conversationId: string;
}

export interface AssistantUploadResult {
  url: string;
  mimeType: AssistantUploadMimeType;
  filename: string;
  width?: number;
  height?: number;
}

interface SignResponse {
  uploadUrl: string;
  downloadUrl: string;
  mimeType: AssistantUploadMimeType;
  expiresAt: string;
  contentLengthMax: number;
}

const isAcceptedMime = (type: string): type is AssistantUploadMimeType =>
  (ASSISTANT_UPLOAD_MIME_TYPES as readonly string[]).includes(type);

/**
 * Pure validation — exported for tests / extracted helpers. Returns null on
 * acceptance, an error message on rejection.
 */
export function validateAssistantUploadFile(file: File): string | null {
  if (!isAcceptedMime(file.type)) {
    return 'Only JPG, PNG, and WebP images are supported.';
  }
  if (file.size > ASSISTANT_UPLOAD_MAX_BYTES) {
    return 'Image must be under 10 MB.';
  }
  return null;
}

async function readImageDimensions(
  file: File
): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    return null;
  }
}

async function uploadToSignedUrl(uploadUrl: string, file: File): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!response.ok) {
    throw new Error('Upload failed. Please try again.');
  }
}

export interface UseAssistantUpload {
  upload: (params: AssistantUploadParams) => Promise<AssistantUploadResult>;
  isUploading: boolean;
  reset: () => void;
}

export function useAssistantUpload(): UseAssistantUpload {
  const mutation = useMutation({
    mutationFn: async ({
      file,
      conversationId,
    }: AssistantUploadParams): Promise<AssistantUploadResult> => {
      const validationError = validateAssistantUploadFile(file);
      if (validationError) {
        throw new Error(validationError);
      }
      // Type narrowing — validation above guarantees this.
      const mimeType = file.type as AssistantUploadMimeType;

      const sign = await apiClient.post<SignResponse>(
        'assistant/uploads/sign',
        { conversationId, mimeType }
      );

      await uploadToSignedUrl(sign.uploadUrl, file);

      const dims = await readImageDimensions(file);

      return {
        url: sign.downloadUrl,
        mimeType: sign.mimeType,
        filename: file.name,
        ...(dims ?? {}),
      };
    },
  });

  return {
    upload: mutation.mutateAsync,
    isUploading: mutation.isPending,
    reset: mutation.reset,
  };
}
