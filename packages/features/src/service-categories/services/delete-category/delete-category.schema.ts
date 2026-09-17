import { z } from 'zod';

export const deleteCategorySchema = z.object({
  id: z.string().min(1, 'Category ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type DeleteCategoryInput = z.infer<typeof deleteCategorySchema>;
