import { z } from 'zod';

/**
 * Input for `synthesizeVideoInput`.
 *
 * Mirrors the partial payload `POST /videos` accepts (`createVideoPartialSchema`)
 * plus the request context (`organizationId`, `createdById`) the controller used
 * to inject from decorators. `draftConfig` stays `unknown` here because it is
 * handed straight to `synthesizeDraftConfig` as caller overrides; the real
 * validation happens in `createVideo` against `draftConfigSchema`.
 */
export const synthesizeVideoInputSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  createdById: z.string().min(1, 'Created by ID is required'),
  title: z.string().optional(),
  templateId: z.string().optional(),
  variationId: z.string().optional(),
  serviceId: z.string().optional(),
  offerId: z.string().optional(),
  format: z.string().optional(),
  /**
   * Paid ad vs organic social post. Carried through from the request so an
   * organic ask with NO format rotates through the organic templates rather
   * than falling to the ad default.
   */
  usageType: z.enum(['ad', 'organic']).optional(),
  draftConfig: z.unknown().optional(),
});

export type SynthesizeVideoInputInput = z.infer<
  typeof synthesizeVideoInputSchema
>;
