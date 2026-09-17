import { z } from 'zod';

/**
 * Schema for pausing a campaign (uses Meta campaign ID)
 */
export const pauseCampaignSchema = z.object({
  metaCampaignId: z.string().min(1, 'Meta Campaign ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type PauseCampaignInput = z.infer<typeof pauseCampaignSchema>;
