import { z } from 'zod';

export const deleteProductBrandSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});

export type DeleteProductBrandInput = z.infer<typeof deleteProductBrandSchema>;
