import { z } from 'zod';

export const saveMessagesSchema = z.object({
  conversationId: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  userMessageContent: z.string(),
  assistantText: z.string(),
  toolCalls: z.unknown().optional(),
  toolResults: z.unknown().optional(),
});

export type SaveMessagesInput = z.infer<typeof saveMessagesSchema>;
