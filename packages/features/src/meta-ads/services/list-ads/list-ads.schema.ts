import { metaAdStatusValues } from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Schema for listing ads
 */
export const listAdsSchema = z.object({
  metaCampaignId: z.string().min(1).optional(),
  organizationId: z.string().min(1, 'Organization ID is required'),
  status: z.enum(metaAdStatusValues).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

/**
 * Input type for listing ads
 */
export type ListAdsInput = z.infer<typeof listAdsSchema>;
