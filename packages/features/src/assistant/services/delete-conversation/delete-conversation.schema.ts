import { z } from 'zod';

export const deleteConversationSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
});

export type DeleteConversationInput = z.infer<typeof deleteConversationSchema>;
