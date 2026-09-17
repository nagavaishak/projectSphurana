import { z } from 'zod';

/**
 * Schema for deleting a campaign (uses Meta campaign ID)
 */
export const deleteCampaignSchema = z.object({
  metaCampaignId: z.string().min(1, 'Meta Campaign ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type DeleteCampaignInput = z.infer<typeof deleteCampaignSchema>;
