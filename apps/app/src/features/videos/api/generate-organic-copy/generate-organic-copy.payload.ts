import { generateOrganicCopyRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';
import type { GenerateOrganicCopyInput } from './generate-organic-copy.input';

/**
 * The wire body for `POST /videos/generate-organic-copy`, built in exactly one
 * place. `.strict()` so an extra or missing field is a parse error, not a
 * silent strip. Every surface passes the shared
 * {@link GenerateOrganicCopyInput} intent; only the builder below assembles
 * the request.
 */
export const generateOrganicCopyBodySchema = generateOrganicCopyRequestSchema;

export type GenerateOrganicCopyBody = z.infer<
  typeof generateOrganicCopyBodySchema
>;

export function buildGenerateOrganicCopyPayload(
  input: GenerateOrganicCopyInput
): GenerateOrganicCopyBody {
  return generateOrganicCopyBodySchema.parse({
    variationId: input.variationId,
    serviceId: input.serviceId,
    refinementInstruction: input.refinementInstruction,
    priorCopy: input.priorCopy,
  });
}
