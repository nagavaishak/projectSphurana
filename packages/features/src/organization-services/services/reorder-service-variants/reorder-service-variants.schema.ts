import { z } from 'zod';

/**
 * Schema for reordering a service's variants. `orderedIds` is the full set of
 * the service's variant ids in the desired order; each variant's `sortOrder` is
 * set to its index. Org-scoped on the parent service.
 */
export const reorderServiceVariantsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  serviceId: z.string().min(1, 'Service ID is required'),
  orderedIds: z
    .array(z.string().min(1))
    .min(1, 'At least one variant id is required'),
});

export type ReorderServiceVariantsInput = z.infer<
  typeof reorderServiceVariantsSchema
>;
