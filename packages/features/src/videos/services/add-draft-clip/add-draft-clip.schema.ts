import {
  videoDraftClipProcessingStatusValues,
  videoDraftClipSourceValues,
} from '@borradh-workspace/database';
import { z } from 'zod';

/**
 * Input for `addDraftClip` — single-row insert into the chat-native tray.
 *
 * Used by the upload-completion handler (frontend), the `videos_autoSelectClips`
 * tool (server-side, after persisting suggestions), and the future
 * library-picker tool. `assetId` is required at insert time — the in-flight
 * `uploading` placeholder shape (assetId nullable) was reserved on the
 * schema for forward-compat but isn't exercised by current callers.
 */
export const addDraftClipSchema = z.object({
  videoId: z.string().uuid(),
  organizationId: z.string().min(1),
  assetId: z.string().uuid(),
  source: z.enum(videoDraftClipSourceValues),
  beatOrder: z.number().int().min(0).optional(),
  processingStatus: z
    .enum(videoDraftClipProcessingStatusValues)
    .optional()
    .default('processing'),
});

export type AddDraftClipInput = z.infer<typeof addDraftClipSchema>;
