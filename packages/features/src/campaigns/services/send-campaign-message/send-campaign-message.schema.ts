import { z } from 'zod';

export const sendCampaignMessageSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  recipientId: z.string().min(1, 'Recipient ID is required'),
});

export type SendCampaignMessageInput = z.infer<
  typeof sendCampaignMessageSchema
>;
