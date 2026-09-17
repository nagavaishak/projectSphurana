import { z } from 'zod';

export const listPackagesSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  isActive: z.boolean().optional(),
  categoryId: z.string().optional().nullable(),
});

export type ListPackagesInput = z.infer<typeof listPackagesSchema>;
