import { z } from 'zod';

/**
 * Schema for syncing ad status from Meta
 */
export const syncAdStatusSchema = z.object({
  adId: z.string().min(1, 'Ad ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type SyncAdStatusInput = z.infer<typeof syncAdStatusSchema>;
