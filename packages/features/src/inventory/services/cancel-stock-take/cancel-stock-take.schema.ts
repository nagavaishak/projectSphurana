import { z } from 'zod';

export const cancelStockTakeSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});

export type CancelStockTakeInput = z.infer<typeof cancelStockTakeSchema>;
