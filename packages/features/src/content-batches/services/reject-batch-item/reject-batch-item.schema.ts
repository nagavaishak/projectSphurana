import { z } from 'zod';

export const rejectBatchItemSchema = z.object({
  itemId: z.string().min(1, 'Item ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type RejectBatchItemInput = z.infer<typeof rejectBatchItemSchema>;
