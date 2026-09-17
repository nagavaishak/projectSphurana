import { z } from 'zod';

/**
 * Schema for deleting a service variant. `id` + `organizationId` scope the
 * delete: the variant's parent service must belong to the active org.
 */
export const deleteServiceVariantSchema = z.object({
  id: z.string().min(1, 'Variant ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type DeleteServiceVariantInput = z.infer<
  typeof deleteServiceVariantSchema
>;
