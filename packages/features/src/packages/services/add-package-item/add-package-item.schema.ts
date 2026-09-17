import { z } from 'zod';

export const addPackageItemSchema = z.object({
  packageId: z.string().min(1, 'Package ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  serviceId: z.string().min(1, 'Service ID is required'),
  quantity: z.number().int().min(1).max(999).default(1),
  sortOrder: z.number().int().min(0).optional().default(0),
});

export type AddPackageItemInput = z.infer<typeof addPackageItemSchema>;
