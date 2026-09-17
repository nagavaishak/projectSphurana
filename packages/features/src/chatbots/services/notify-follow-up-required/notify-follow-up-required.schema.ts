import { z } from 'zod';

export const notifyFollowUpRequiredSchema = z.object({
  conversationId: z.string().min(1),
  followUpReason: z.string().min(1),
});

export type NotifyFollowUpRequiredInput = z.infer<
  typeof notifyFollowUpRequiredSchema
>;
