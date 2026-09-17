import { z } from 'zod';

/**
 * Schema for deleting an offer
 */
export const deleteOfferSchema = z.object({
  id: z.string().min(1, 'Offer ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  actorId: z.string().optional(),
});

/**
 * Input type inferred from schema
 */
export type DeleteOfferInput = z.infer<typeof deleteOfferSchema>;
