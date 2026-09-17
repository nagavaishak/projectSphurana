import { z } from 'zod';

/**
 * Input for `updateBatchItemCaption` — a direct caption write.
 *
 * Serves two UI actions with one path: typing in the caption box, and reverting
 * to an earlier version from the thread. Both are "set the caption to exactly
 * this", and neither involves the model.
 */
export const updateBatchItemCaptionSchema = z.object({
  itemId: z.string().min(1),
  organizationId: z.string().min(1),
  caption: z.string().min(1).max(2200),
});

export type UpdateBatchItemCaptionInput = z.infer<
  typeof updateBatchItemCaptionSchema
>;
