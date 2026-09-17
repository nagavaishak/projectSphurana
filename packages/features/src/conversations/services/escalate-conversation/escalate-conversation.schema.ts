import { z } from 'zod';

export const escalationReasons = [
  'ai_handoff',
  'ai_silent_handoff',
  'needs_follow_up',
  'inappropriate_content',
  'user_requested_human',
  'agent_takeover',
  'max_follow_ups',
  'delivery_failed',
  'manual',
] as const;

export type EscalationReason = (typeof escalationReasons)[number];

export const escalateConversationSchema = z.object({
  conversationId: z.string().min(1),
  reason: z.enum(escalationReasons),
  reasonDetail: z.string().optional(),
  notifyAgents: z.boolean().default(true),
  insertSystemMessage: z.boolean().default(true),
});

export type EscalateConversationInput = z.input<
  typeof escalateConversationSchema
>;
