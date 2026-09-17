import { generateOfferContentRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';

/**
 * The typed INTENT for generating offer content. Only
 * {@link buildGenerateOfferContentPayload} turns it into the wire body.
 */
export interface GenerateOfferContentInput {
  serviceId?: string;
  headline?: string;
}

/**
 * The wire body for `POST /ai-content/generate-offer-content`, built in
 * exactly one place. `.strict()` so an extra or missing field is a parse
 * error, not a silent strip.
 */
export const generateOfferContentBodySchema = generateOfferContentRequestSchema;

export type GenerateOfferContentBody = z.infer<
  typeof generateOfferContentBodySchema
>;

export function buildGenerateOfferContentPayload(
  input: GenerateOfferContentInput
): GenerateOfferContentBody {
  return generateOfferContentBodySchema.parse({
    serviceId: input.serviceId,
    headline: input.headline,
  });
}
