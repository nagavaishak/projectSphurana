import { z } from 'zod';

export const deletePackageSchema = z.object({
  id: z.string().min(1, 'Package ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type DeletePackageInput = z.infer<typeof deletePackageSchema>;
