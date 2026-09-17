import { z } from 'zod';

/**
 * Schema for getting campaign insights (uses Meta campaign ID)
 */
export const getCampaignInsightsSchema = z.object({
  metaCampaignId: z.string().min(1, 'Meta Campaign ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  dateRange: z
    .object({
      since: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
      until: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    })
    .optional(),
});

export type GetCampaignInsightsInput = z.infer<
  typeof getCampaignInsightsSchema
>;
