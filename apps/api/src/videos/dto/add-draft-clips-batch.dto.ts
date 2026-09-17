import {
  videoDraftClipProcessingStatusValues,
  videoDraftClipSourceValues,
} from '@borradh-workspace/database';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * POST /videos/:id/draft-clips body for the batch shape — append N rows in
 * one round-trip. Used by `videos_autoSelectClips` to persist N suggestions
 * after the model picks them. The single-row shape (`AddDraftClipDto`) is
 * still accepted on the same route via discriminated union.
 */
export const addDraftClipsBatchInputSchema = z.object({
  clips: z
    .array(
      z.object({
        assetId: z.string().uuid(),
        source: z.enum(videoDraftClipSourceValues),
        beatOrder: z.number().int().min(0).optional(),
        processingStatus: z
          .enum(videoDraftClipProcessingStatusValues)
          .optional(),
      })
    )
    .min(1)
    .max(20),
});

export class AddDraftClipsBatchDto extends createZodDto(
  addDraftClipsBatchInputSchema
) {}
