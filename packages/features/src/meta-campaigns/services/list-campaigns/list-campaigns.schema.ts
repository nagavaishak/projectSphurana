import { z } from 'zod';

/**
 * Schema for listing campaigns (fetched from Meta API)
 */
export const listCampaignsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type ListCampaignsInput = z.infer<typeof listCampaignsSchema>;
