import { z } from 'zod';

export const escalateConversationSchema = z.object({
  conversationId: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  // Free-form reason. Auto-fills to "user_requested" in the controller when
  // the user clicks "pass to team" without providing a reason. Kept as a
  // string (not an enum) so the UI can later collect a detail without a
  // schema change. See claire-spec-v2.md Decision 5.
  reason: z.string().max(500).optional(),
  // Set when the escalation is bonded to an Intercom conversation. Stored on
  // assistantConversation so the webhook can map admin replies back to the
  // right Claire thread. Null on plain "pass to team" escalations that don't
  // open Intercom (e.g., the legacy customer-conversations escalate flow).
  intercomConversationId: z.string().min(1).optional(),
});

export type EscalateConversationInput = z.infer<
  typeof escalateConversationSchema
>;
