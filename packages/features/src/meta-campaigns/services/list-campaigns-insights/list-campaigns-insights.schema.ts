import { z } from 'zod';

/**
 * Schema for listing insights for every campaign in an organization's ad
 * account in a single batched call.
 */
export const listCampaignsInsightsSchema = z.object({
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

export type ListCampaignsInsightsInput = z.infer<
  typeof listCampaignsInsightsSchema
>;
