import { z } from 'zod';

/**
 * Get video input schema
 */
export const getVideoSchema = z.object({
  id: z.string().min(1, 'Video ID is required'),
});

export type GetVideoInput = z.infer<typeof getVideoSchema>;
