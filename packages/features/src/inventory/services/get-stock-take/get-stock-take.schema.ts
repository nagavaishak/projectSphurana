import { z } from 'zod';

export const getStockTakeSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});

export type GetStockTakeInput = z.infer<typeof getStockTakeSchema>;
