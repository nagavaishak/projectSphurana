import { z } from 'zod';

export const updateMessageStatusSchema = z.object({
  externalMessageId: z.string().min(1),
  status: z.enum(['sent', 'delivered', 'read']),
  timestamp: z.number(),
});

export type UpdateMessageStatusInput = z.infer<
  typeof updateMessageStatusSchema
>;
