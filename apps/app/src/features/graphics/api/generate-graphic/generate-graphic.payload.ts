import { generateGraphicFromServiceRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';
import type { GenerateGraphicInput } from './generate-graphic.input';

/**
 * The wire body for `POST /graphics/generate`, built in exactly one place.
 *
 * `.strict()` so an extra or missing field is a parse error, not a silent
 * strip — this is what stops the new-post-dialog and the gallery-new wizard
 * (generate-graphic-dialog) from drifting apart. Every surface passes the
 * shared {@link GenerateGraphicInput} intent; only the builder below assembles
 * the request.
 */
export const generateGraphicBodySchema =
  generateGraphicFromServiceRequestSchema;

export type GenerateGraphicBody = z.infer<typeof generateGraphicBodySchema>;

export function buildGenerateGraphicPayload(
  input: GenerateGraphicInput
): GenerateGraphicBody {
  return generateGraphicBodySchema.parse({
    serviceId: input.serviceId,
    category: input.category,
    kind: input.kind,
    topicSummary: input.topicSummary,
    allowAiImages: input.allowAiImages,
    allowStockImages: input.allowStockImages,
    sourceAssetIds: input.sourceAssetIds,
    usageType: input.usageType,
    offerId: input.offerId,
    refinementInstruction: input.refinementInstruction,
    itemId: input.itemId,
    templateSlug: input.templateSlug,
  });
}
