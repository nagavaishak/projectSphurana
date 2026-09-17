import { z } from 'zod';

export const getConversationSchema = z.object({
  id: z.string().min(1, 'Conversation ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetConversationInput = z.infer<typeof getConversationSchema>;
