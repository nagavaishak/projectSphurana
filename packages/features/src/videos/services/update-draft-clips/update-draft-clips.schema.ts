import {
  videoDraftClipProcessingStatusValues,
  videoDraftClipSourceValues,
} from '@borradh-workspace/database';
import { z } from 'zod';

/**
 * One clip in a tray-replace request — the whole tray for `videoId` is
 * rewritten to whatever array the caller supplies. `id` is omitted; the
 * service generates new row ids on insert (DELETE-then-INSERT pattern).
 */
const updateDraftClipEntrySchema = z.object({
  assetId: z.string().uuid(),
  source: z.enum(videoDraftClipSourceValues),
  beatOrder: z.number().int().min(0),
  processingStatus: z
    .enum(videoDraftClipProcessingStatusValues)
    .optional()
    .default('ready'),
});

export const updateDraftClipsSchema = z.object({
  videoId: z.string().uuid(),
  organizationId: z.string().min(1),
  clips: z.array(updateDraftClipEntrySchema).max(20),
});

export type UpdateDraftClipsInput = z.infer<typeof updateDraftClipsSchema>;
export type UpdateDraftClipEntry = z.infer<typeof updateDraftClipEntrySchema>;
