import { z } from 'zod';

export const syncConversationMessagesSchema = z.object({
  organizationId: z.string().min(1),
});

export type SyncConversationMessagesInput = z.infer<
  typeof syncConversationMessagesSchema
>;
