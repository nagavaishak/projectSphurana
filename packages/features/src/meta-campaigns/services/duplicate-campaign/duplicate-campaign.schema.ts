import { z } from 'zod';

export const duplicateCampaignSchema = z.object({
  metaCampaignId: z.string().min(1, 'Meta Campaign ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type DuplicateCampaignInput = z.infer<typeof duplicateCampaignSchema>;
