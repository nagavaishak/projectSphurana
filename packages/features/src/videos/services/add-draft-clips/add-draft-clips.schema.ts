import {
  videoDraftClipProcessingStatusValues,
  videoDraftClipSourceValues,
} from '@borradh-workspace/database';
import { z } from 'zod';

const entrySchema = z.object({
  assetId: z.string().uuid(),
  source: z.enum(videoDraftClipSourceValues),
  beatOrder: z.number().int().min(0).optional(),
  processingStatus: z.enum(videoDraftClipProcessingStatusValues).optional(),
});

/**
 * Input for `addDraftClips` — the single `POST /videos/:id/draft-clips` route,
 * which accepts BOTH a batch (`{ clips: [...] }`) and a single clip
 * (`{ assetId, source, ... }`).
 *
 * The two shapes are not interchangeable on the way out either: the batch
 * responds `{ clips: [...] }` while the single responds with the BARE row.
 * `videos_autoSelectClips` depends on the first, the frontend's single-drop
 * handler on the second.
 */
export const addDraftClipsSchema = z.object({
  videoId: z.string().uuid(),
  organizationId: z.string().min(1),
  clips: z.array(entrySchema).optional(),
  assetId: z.string().uuid().optional(),
  source: z.enum(videoDraftClipSourceValues).optional(),
  beatOrder: z.number().int().min(0).optional(),
  processingStatus: z.enum(videoDraftClipProcessingStatusValues).optional(),
});

export type AddDraftClipsInput = z.infer<typeof addDraftClipsSchema>;
