import { z } from 'zod';

export const getStockOrderSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});

export type GetStockOrderInput = z.infer<typeof getStockOrderSchema>;
