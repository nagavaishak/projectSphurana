import { z } from 'zod';

export const listBatchItemMessagesSchema = z.object({
  itemId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type ListBatchItemMessagesInput = z.infer<
  typeof listBatchItemMessagesSchema
>;
