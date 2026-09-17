import { z } from 'zod';

/**
 * MIME types accepted for assistant image attachments.
 *
 * Anthropic vision (Sonnet 4.6 / Opus 4.7) accepts jpeg/png/gif/webp via the
 * Base64ImageSource media_type union (per @anthropic-ai/sdk@0.91.1). Claire-v3
 * intentionally narrows this to jpeg/png/webp — gif is excluded because
 * animated gif frames the vision API folds into a single still confuse the
 * "what's in this image?" UX. Locked decision per claire.md §2.
 */
export const ASSISTANT_UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AssistantUploadMimeType =
  (typeof ASSISTANT_UPLOAD_MIME_TYPES)[number];

export const ASSISTANT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export const signUploadUrlSchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  conversationId: z.string().min(1),
  mimeType: z.enum(ASSISTANT_UPLOAD_MIME_TYPES),
});

export type SignUploadUrlInput = z.infer<typeof signUploadUrlSchema>;
