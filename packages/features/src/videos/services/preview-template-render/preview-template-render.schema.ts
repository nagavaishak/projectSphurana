import { z } from 'zod';

/**
 * Input for `previewTemplateRender` (`POST /videos/template-preview`).
 *
 * `version` is intentionally typed loosely here: the endpoint's contract is a
 * hand-rolled check producing the exact message `"version must be 'v1' or 'v2'"`,
 * which a zod enum would not reproduce.
 */
export const previewTemplateRenderSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  createdById: z.string().min(1, 'Created by ID is required'),
  templateId: z.string().optional(),
  variationId: z.string().optional(),
  format: z.string().optional(),
  serviceId: z.string().optional(),
  offerId: z.string().optional(),
  version: z.unknown().optional(),
});

export type PreviewTemplateRenderInput = z.infer<
  typeof previewTemplateRenderSchema
>;

export interface PreviewTemplateRenderOutput {
  videoId: string;
}
