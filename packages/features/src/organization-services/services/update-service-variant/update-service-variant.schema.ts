import { z } from 'zod';

/**
 * Schema for updating a service variant. `id` + `organizationId` scope the
 * write: the variant's parent service must belong to the active org (validated
 * in the service). All value fields are optional — only provided ones change.
 */
export const updateServiceVariantSchema = z.object({
  id: z.string().min(1, 'Variant ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  name: z.string().min(1).max(100).optional(),
  priceCents: z.number().int().min(0).optional().nullable(),
  durationMinutes: z.number().int().min(5).max(480).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateServiceVariantInput = z.infer<
  typeof updateServiceVariantSchema
>;
