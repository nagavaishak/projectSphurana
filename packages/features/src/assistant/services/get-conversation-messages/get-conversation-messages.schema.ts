import { z } from 'zod';

export const getConversationMessagesSchema = z.object({
  conversationId: z.string().min(1),
  organizationId: z.string().min(1),
  /**
   * Window bound (claire WhatsApp memory): the WhatsApp channel is one
   * persistent, ever-growing thread with no client-side bounding, so we cap
   * how many of the most-recent rows we load to keep the prompt from growing
   * unbounded. Defaults to {@link DEFAULT_MESSAGE_WINDOW}.
   */
  limit: z.number().int().positive().max(500).default(60),
});

// `z.input` (not `z.infer`/`z.output`) so the defaulted `limit` is optional for
// callers; the service reads the defaulted value off the parsed output.
export type GetConversationMessagesInput = z.input<
  typeof getConversationMessagesSchema
>;
