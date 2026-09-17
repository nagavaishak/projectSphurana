import { z } from 'zod';

/**
 * Accept the intro-offer slide: turn the negotiated intro offer into a REAL
 * `offer` row (via the existing `createOffer` service) and pin it on the
 * onboarding session (`session.offerId`).
 *
 * `offerPriceCents` is the owner's adjusted first-visit price. When omitted,
 * the curated `suggestIntroOffer` price is used (the same 30–40%-below charm
 * price Claire proposes in the create-campaign flow).
 */
export const acceptIntroOfferSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  /** Owner-adjusted intro price in cents. Omit to take the suggested price. */
  offerPriceCents: z.number().int().positive().optional(),
  /** Free-text negotiation note from the slide — carried for observability. */
  notes: z.string().max(1000).optional(),
});

export type AcceptIntroOfferInput = z.infer<typeof acceptIntroOfferSchema>;

export interface AcceptIntroOfferOutput {
  offerId: string;
  offerPriceCents: number;
}
