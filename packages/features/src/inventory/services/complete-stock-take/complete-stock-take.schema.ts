import { z } from 'zod';

export const completeStockTakeSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});

export type CompleteStockTakeInput = z.infer<typeof completeStockTakeSchema>;
