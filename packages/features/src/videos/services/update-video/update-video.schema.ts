import { updateVideoRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Update video input schema.
 *
 * DERIVED from the canonical wire contract (`updateVideoRequestBase` in
 * `@borradh-workspace/contracts`) by extending the route param onto it. Field
 * rules — including the SHALLOW `draftConfig` partial — live in the contract;
 * do not restate them here.
 */
export const updateVideoSchema = updateVideoRequestBase.extend({
  id: z.string().min(1, 'Video ID is required'),
});

export type UpdateVideoInput = z.infer<typeof updateVideoSchema>;
