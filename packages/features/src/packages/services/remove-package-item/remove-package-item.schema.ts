import { z } from 'zod';

export const removePackageItemSchema = z.object({
  packageId: z.string().min(1, 'Package ID is required'),
  itemId: z.string().min(1, 'Item ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type RemovePackageItemInput = z.infer<typeof removePackageItemSchema>;
