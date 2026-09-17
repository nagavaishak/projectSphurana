import { z } from 'zod';

export const createConversationSchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  title: z.string().max(100).optional(),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
