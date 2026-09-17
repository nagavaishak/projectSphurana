import { z } from 'zod';

export const listProductCategoriesSchema = z.object({
  organizationId: z.string().min(1),
});

export type ListProductCategoriesInput = z.infer<
  typeof listProductCategoriesSchema
>;
