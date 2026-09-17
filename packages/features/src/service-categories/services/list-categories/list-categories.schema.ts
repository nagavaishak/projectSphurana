import { z } from 'zod';

export const listCategoriesSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  isActive: z.boolean().optional(),
});

export type ListCategoriesInput = z.infer<typeof listCategoriesSchema>;
