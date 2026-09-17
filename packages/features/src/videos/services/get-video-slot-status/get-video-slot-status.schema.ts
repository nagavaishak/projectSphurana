import { z } from 'zod';

/**
 * Get video slot status input schema
 */
export const getVideoSlotStatusSchema = z.object({
  videoId: z.string().min(1, 'Video ID is required'),
});

export type GetVideoSlotStatusInput = z.infer<typeof getVideoSlotStatusSchema>;
