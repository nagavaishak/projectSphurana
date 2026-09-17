import { z } from 'zod';

export const getCampaignSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  id: z.string().min(1, 'Campaign ID is required'),
});

export type GetCampaignInput = z.infer<typeof getCampaignSchema>;
