import { z } from 'zod';

export const getPackageSchema = z.object({
  id: z.string().min(1, 'Package ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetPackageInput = z.infer<typeof getPackageSchema>;
