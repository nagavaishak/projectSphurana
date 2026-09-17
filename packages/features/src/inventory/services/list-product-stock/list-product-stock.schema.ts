import { z } from 'zod';

export const listProductStockSchema = z.object({
  productId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type ListProductStockInput = z.infer<typeof listProductStockSchema>;
