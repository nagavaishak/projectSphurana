import { generateOfferCopyRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';

/**
 * The typed INTENT for generating offer copy. Every surface (new-post-dialog,
 * generate-video-dialog, create-video offer-step) passes this; only
 * {@link buildGenerateOfferCopyPayload} turns it into the wire body.
 */
export interface GenerateOfferCopyInput {
  offerId: string;
  /** Optional free-text instruction to steer the copy. */
  refinementInstruction?: string;
  /** Previously generated copy, for refinement-aware re-rolls. */
  priorCopy?: Record<string, unknown>;
}

/**
 * The wire body for `POST /ai-content/generate-offer-copy`, built in exactly
 * one place. `.strict()` so an extra or missing field is a parse error, not a
 * silent strip. Every surface passes the shared {@link GenerateOfferCopyInput}
 * intent; only the builder below assembles the request.
 */
export const generateOfferCopyBodySchema = generateOfferCopyRequestSchema;

export type GenerateOfferCopyBody = z.infer<typeof generateOfferCopyBodySchema>;

export function buildGenerateOfferCopyPayload(
  input: GenerateOfferCopyInput
): GenerateOfferCopyBody {
  return generateOfferCopyBodySchema.parse({
    offerId: input.offerId,
    refinementInstruction: input.refinementInstruction,
    priorCopy: input.priorCopy,
  });
}
