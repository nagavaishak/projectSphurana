import { z } from 'zod';

export const getTroubleshootStateSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  metaCampaignId: z.string().min(1, 'Campaign ID is required'),
});

export type GetTroubleshootStateInput = z.infer<
  typeof getTroubleshootStateSchema
>;
