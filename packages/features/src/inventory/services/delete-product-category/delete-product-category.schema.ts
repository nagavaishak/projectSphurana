import { z } from 'zod';

export const deleteProductCategorySchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});

export type DeleteProductCategoryInput = z.infer<
  typeof deleteProductCategorySchema
>;
