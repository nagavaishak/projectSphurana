import { z } from 'zod';

export const listMessagesSchema = z.object({
  conversationId: z.string().min(1, 'Conversation ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export type ListMessagesInput = z.infer<typeof listMessagesSchema>;
