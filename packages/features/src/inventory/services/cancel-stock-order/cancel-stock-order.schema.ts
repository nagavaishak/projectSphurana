import { z } from 'zod';

export const cancelStockOrderSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});

export type CancelStockOrderInput = z.infer<typeof cancelStockOrderSchema>;
