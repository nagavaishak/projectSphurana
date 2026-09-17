import { z } from 'zod';

export const syncAllAdsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type SyncAllAdsInput = z.infer<typeof syncAllAdsSchema>;
