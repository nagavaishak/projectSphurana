import { generateVideoScriptRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';
import type { GenerateVideoScriptInput } from './generate-video-script.input';

/**
 * The wire body for `POST /videos/generate-script`, built in exactly one place.
 *
 * `.strict()` so an extra or missing field is a parse error, not a silent
 * strip — this is what stops the multiple script-generate surfaces from
 * drifting apart. Every surface passes the shared
 * {@link GenerateVideoScriptInput} intent; only the builder below assembles
 * the request. Optional fields are only emitted when the surface set them, so
 * the request stays minimal.
 */
export const generateVideoScriptBodySchema = generateVideoScriptRequestSchema;

export type GenerateVideoScriptBody = z.infer<
  typeof generateVideoScriptBodySchema
>;

export function buildGenerateVideoScriptPayload(
  input: GenerateVideoScriptInput
): GenerateVideoScriptBody {
  return generateVideoScriptBodySchema.parse({
    templateId: input.templateId,
    variationId: input.variationId,
    serviceId: input.serviceId,
    narrationMode: input.narrationMode,
    refinementInstruction: input.refinementInstruction,
    priorScriptText: input.priorScriptText,
  });
}
