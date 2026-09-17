import { z } from 'zod';

export const reorderCategoriesSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  orderedIds: z.array(z.string().min(1)).min(1),
});

export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>;
