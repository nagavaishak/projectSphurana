import { z } from 'zod';

export const updateProductCategorySchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string().min(1, 'Name is required'),
});

export type UpdateProductCategoryInput = z.infer<
  typeof updateProductCategorySchema
>;
