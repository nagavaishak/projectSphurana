import { z } from 'zod';

export const updatePackageItemSchema = z.object({
  packageId: z.string().min(1, 'Package ID is required'),
  itemId: z.string().min(1, 'Item ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  quantity: z.number().int().min(1).max(999).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export type UpdatePackageItemInput = z.infer<typeof updatePackageItemSchema>;
