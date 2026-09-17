import { z } from 'zod';

/**
 * Variation IDs the organic-copy generator accepts. Kept as a literal union
 * (not imported from features) so the app doesn't have to pull in backend
 * type-only modules just for this string.
 */
export const organicVariationIds = [
  'caption-tease-1',
  'fade-benefits-1',
  'aesthetic-line-1',
  'numbered-list-1',
  'ins-outs-1',
  'question-cta-1',
  'improves-1',
  'highlight-caption-1',
  'curiosity-hook-1',
  'step-timer-1',
  'time-progress-1',
  'poll-1',
  'myth-fact-1',
  'versus-1',
  'price-reveal-1',
  'client-question-1',
  'come-with-me-1',
] as const;

export type OrganicVariationId = (typeof organicVariationIds)[number];

/**
 * The typed INTENT for generating organic on-screen copy. Every entry point
 * (new-post-dialog, generate-video-dialog, generate-organic-video-dialog)
 * passes this; only {@link buildGenerateOrganicCopyPayload} turns it into the
 * wire body.
 */
export const generateOrganicCopyInputSchema = z.object({
  variationId: z.enum(organicVariationIds),
  serviceId: z.string().optional(),
  /** Optional free-text instruction to steer the generated copy. */
  refinementInstruction: z.string().optional(),
  /** Previously generated copy, for refinement-aware re-rolls. */
  priorCopy: z.record(z.string(), z.unknown()).optional(),
});

export type GenerateOrganicCopyInput = z.infer<
  typeof generateOrganicCopyInputSchema
>;
