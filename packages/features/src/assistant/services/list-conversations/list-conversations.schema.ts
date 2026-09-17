import { z } from 'zod';

export const listConversationsSchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
});

export type ListConversationsInput = z.infer<typeof listConversationsSchema>;
