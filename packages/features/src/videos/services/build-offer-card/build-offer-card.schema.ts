import { z } from 'zod';

/**
 * Input for `buildOfferCard`. Resolves a full `offerCard` draft-config block
 * for the one-prompt offer-video creation flow.
 */
export const buildOfferCardSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  offerId: z.string().min(1, 'Offer ID is required'),
  /** Service the video is about — seeds the card's serviceName. */
  serviceId: z.string().min(1).optional(),
  serviceName: z.string().min(1).optional(),
  /** Org display name for the card footer. */
  businessName: z.string().min(1).optional(),
});

export type BuildOfferCardInput = z.infer<typeof buildOfferCardSchema>;
