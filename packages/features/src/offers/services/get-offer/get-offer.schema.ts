import { z } from 'zod';

/**
 * Schema for getting a single offer
 */
export const getOfferSchema = z.object({
  id: z.string().min(1, 'Offer ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * Input type inferred from schema
 */
export type GetOfferInput = z.infer<typeof getOfferSchema>;
