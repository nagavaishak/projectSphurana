import { z } from 'zod';

/**
 * Input schema for `summariseConversation`.
 *
 * Per the c13-conversation-summaries brief: input is the conversation +
 * organization + user identity. The service reads the conversation's full
 * message history (via `getConversation`) and writes a `conversation_summary`
 * knowledge entry scoped to `(organizationId, userId)`.
 */
export const summariseConversationSchema = z.object({
  conversationId: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
});

export type SummariseConversationInput = z.infer<
  typeof summariseConversationSchema
>;

/**
 * Output of `summariseConversation`.
 *
 * - `knowledgeEntryId: string` → summary written, ID of the new
 *   `knowledge_entry` row.
 * - `knowledgeEntryId: null` + `skipReason` → service ran but didn't write.
 *   Always a `Result.success: true` — no-write paths (rate-limit, too few
 *   messages, hard-block hit) are expected, not errors. The controller's
 *   fire-and-forget call site doesn't surface this distinction; tests do.
 */
export interface SummariseConversationOutput {
  knowledgeEntryId: string | null;
  skipReason?:
    | 'rate_limited'
    | 'too_few_messages'
    | 'hard_block_tripped'
    | 'empty_summary';
}
