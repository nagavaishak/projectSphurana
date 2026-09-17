import { z } from 'zod';

export const CHATBOT_FLOW_QUEUE = 'chatbot-flow';

export const executeFlowTriggerTypes = [
  'message',
  'delay',
  'timeout',
  'deliver_part',
  'follow_up',
  'expire',
] as const;

export type ExecuteFlowTriggerType = (typeof executeFlowTriggerTypes)[number];

export const executeFlowSchema = z.object({
  conversationId: z.string().min(1, 'Conversation ID is required'),
  userMessage: z.string().optional(),
  triggerType: z.enum(executeFlowTriggerTypes),
});

export type ExecuteFlowInput = z.infer<typeof executeFlowSchema>;

/**
 * Represents a message accumulated during flow execution, to be delivered after.
 */
export interface FlowMessage {
  type: 'text' | 'quick_reply' | 'media';
  text?: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'file';
  quickReplyOptions?: { label: string; value: string }[];
}

/**
 * Result of a single flow execution run.
 */
export interface FlowExecutionResult {
  messages: FlowMessage[];
  newNodeId: string | null;
  stoppedAt: 'delay' | 'waiting' | 'end' | 'handoff' | 'silent_handoff';
  delayMs?: number;
  waitingNodeId?: string;
  /** If handoff, set conversation status to agent_handling */
  setAgentHandling?: boolean;
  /** Metadata updates to merge into conversation.metadata */
  metadataUpdates?: Record<string, unknown>;
  /** Optional detail for escalation reason (passed to escalateConversation) */
  escalationReasonDetail?: string;
  /**
   * A real appointment was written for this turn (AI booking path). Lets the
   * caller allow booking language through the hallucination guard, which is
   * otherwise unconditional: without this the guard cannot tell a true
   * confirmation from an invented one.
   */
  bookingConfirmed?: boolean;
}
