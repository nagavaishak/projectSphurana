import { z } from 'zod';

export const updateProductBrandSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string().min(1, 'Name is required'),
  description: z.string().nullable().optional(),
});

export type UpdateProductBrandInput = z.infer<typeof updateProductBrandSchema>;
