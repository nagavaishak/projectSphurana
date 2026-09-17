import { z } from 'zod';

export const getConversationSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
});

export type GetConversationInput = z.infer<typeof getConversationSchema>;
