import { z } from 'zod';

export const listConversationsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  status: z
    .enum(['active', 'bot_handling', 'agent_handling', 'closed', 'expired'])
    .optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

export type ListConversationsInput = z.infer<typeof listConversationsSchema>;
