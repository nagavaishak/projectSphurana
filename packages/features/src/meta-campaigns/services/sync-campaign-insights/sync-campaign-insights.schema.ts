import { z } from 'zod';

export const syncCampaignInsightsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** Override date to sync (defaults to yesterday). Format: YYYY-MM-DD */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .optional(),
});

export type SyncCampaignInsightsInput = z.infer<
  typeof syncCampaignInsightsSchema
>;
