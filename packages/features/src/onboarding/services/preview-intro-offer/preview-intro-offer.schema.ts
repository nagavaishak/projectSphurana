import { z } from 'zod';

/**
 * Preview the intro offer the accept endpoint WOULD create — same
 * `suggestIntroOffer` inputs as `acceptIntroOffer`, but read-only. Lets the
 * intro-offer slide show the actual first-visit price ("£49 instead of £65")
 * before the owner commits.
 */
export const previewIntroOfferSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

export type PreviewIntroOfferInput = z.infer<typeof previewIntroOfferSchema>;

export interface PreviewIntroOfferOutput {
  serviceId: string;
  serviceName: string;
  /** `false` for POM/surgical services — no cold-traffic price offer. */
  advisable: boolean;
  advisoryReason?: string;
  /** `true` when no regular price is known — the slide keeps generic copy. */
  needsPrice: boolean;
  /** The suggested first-visit price, when one could be computed. */
  offerPriceCents?: number;
  /** The regular one-session price the discount is framed against. */
  originalPriceCents?: number;
  offerName?: string;
}
