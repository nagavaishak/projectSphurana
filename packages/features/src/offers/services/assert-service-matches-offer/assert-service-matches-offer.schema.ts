import { z } from 'zod';

/**
 * Schema for reconciling a chosen service against an offer's linked service(s).
 */
export const assertServiceMatchesOfferSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  offerId: z.string().min(1, 'Offer ID is required'),
  serviceId: z.string().min(1, 'Service ID is required'),
});

/**
 * Input type inferred from schema
 */
export type AssertServiceMatchesOfferInput = z.infer<
  typeof assertServiceMatchesOfferSchema
>;
