import { generateOfferCopyRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for generate-offer-copy — produces the full video-copy bundle
 * (headline, ctaText, urgencyText, audienceText, bulletPoints) for a single
 * offer on-demand.
 *
 * Window 9 (offer rework): the old `offer.headline` / `offer.ctaText` / etc.
 * columns were dropped because they only made sense for the video-creation
 * flow. The video flow now calls this endpoint when the user picks an offer
 * and gets generated copy back.
 *
 * DERIVED from the wire contract — see `generateOfferCopyRequestBase` in
 * `packages/contracts/src/requests/content.ts`.
 */
export const generateOfferCopySchema = generateOfferCopyRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GenerateOfferCopyInput = z.infer<typeof generateOfferCopySchema>;

/**
 * Wire shape returned to clients. All fields are guaranteed non-empty.
 */
export const generatedOfferCopySchema = z.object({
  headline: z.string().min(1).max(80),
  ctaText: z.string().min(1).max(40),
  urgencyText: z.string().min(0).max(80),
  audienceText: z.string().min(0).max(80),
  bulletPoints: z.array(z.string().min(1).max(60)).min(2).max(4),
});

export type GeneratedOfferCopy = z.infer<typeof generatedOfferCopySchema>;
