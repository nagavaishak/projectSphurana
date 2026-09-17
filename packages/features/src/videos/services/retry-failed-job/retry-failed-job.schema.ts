import { z } from 'zod';

/**
 * Retry failed job input schema
 */
export const retryFailedJobSchema = z.object({
  videoId: z.string().min(1, 'Video ID is required'),
});

export type RetryFailedJobInput = z.infer<typeof retryFailedJobSchema>;
