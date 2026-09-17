import { z } from 'zod';

export const getCampaignAnalyticsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  id: z.string().min(1, 'Campaign ID is required'),
});

export type GetCampaignAnalyticsInput = z.infer<
  typeof getCampaignAnalyticsSchema
>;
