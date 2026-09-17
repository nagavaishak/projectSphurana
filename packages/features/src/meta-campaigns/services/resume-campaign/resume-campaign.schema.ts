import { z } from 'zod';

export const resumeCampaignSchema = z.object({
  metaCampaignId: z.string().min(1, 'Meta Campaign ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type ResumeCampaignInput = z.infer<typeof resumeCampaignSchema>;
