import { z } from 'zod';

export const detectStuckConversationsSchema = z.object({
  /** Minutes without a bot reply before a conversation is considered stuck */
  staleMinutes: z.number().int().positive().default(15),
});

export type DetectStuckConversationsInput = z.infer<
  typeof detectStuckConversationsSchema
>;
