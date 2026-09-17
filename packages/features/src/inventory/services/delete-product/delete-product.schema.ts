import { z } from 'zod';

export const deleteProductSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});

export type DeleteProductInput = z.infer<typeof deleteProductSchema>;
