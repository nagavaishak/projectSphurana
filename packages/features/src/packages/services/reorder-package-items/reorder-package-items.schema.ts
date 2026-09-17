import { z } from 'zod';

export const reorderPackageItemsSchema = z.object({
  packageId: z.string().min(1, 'Package ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  orderedIds: z.array(z.string().min(1)).min(1),
});

export type ReorderPackageItemsInput = z.infer<
  typeof reorderPackageItemsSchema
>;
