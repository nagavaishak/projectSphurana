import { z } from 'zod';

/**
 * Delete video input schema
 */
export const deleteVideoSchema = z.object({
  id: z.string().min(1, 'Video ID is required'),
  actorId: z.string().optional(),
});

export type DeleteVideoInput = z.infer<typeof deleteVideoSchema>;
