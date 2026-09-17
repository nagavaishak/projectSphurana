import { z } from 'zod';

/**
 * Get job status input schema
 */
export const getJobStatusSchema = z.object({
  videoId: z.string().min(1, 'Video ID is required'),
});

export type GetJobStatusInput = z.infer<typeof getJobStatusSchema>;
