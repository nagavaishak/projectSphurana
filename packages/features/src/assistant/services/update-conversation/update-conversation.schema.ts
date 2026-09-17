import { z } from 'zod';

export const updateConversationSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  title: z.string().min(1).max(100),
});

export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
