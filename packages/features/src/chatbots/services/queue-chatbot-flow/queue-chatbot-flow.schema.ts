import { z } from 'zod';

export const CHATBOT_FLOW_QUEUE = 'chatbot-flow';

export const chatbotFlowJobTypes = ['execute-flow'] as const;

export type ChatbotFlowJobType = (typeof chatbotFlowJobTypes)[number];

/**
 * Payload for an execute-flow job in the chatbot-flow queue
 */
export const chatbotFlowJobPayloadSchema = z.object({
  conversationId: z.string().min(1, 'Conversation ID is required'),
  userMessage: z.string().optional(),
  triggerType: z.enum([
    'message',
    'delay',
    'timeout',
    'deliver_part',
    'follow_up',
    'expire',
    'booking_fallback',
  ]),
  /** For deliver_part: the message parts to deliver */
  pendingMessageParts: z.array(z.string()).optional(),
  /** For deliver_part: the current part index to deliver */
  currentPartIndex: z.number().int().min(0).optional(),
  /** ISO timestamp of when the job was queued, used for stale job detection */
  queuedAt: z.string().optional(),
  /** When true, bot messages are saved to DB but not sent via external API (for E2E testing) */
  skipExternalDelivery: z.boolean().optional(),
});

export type ChatbotFlowJobPayload = z.infer<typeof chatbotFlowJobPayloadSchema>;

/**
 * Schema for queueing a chatbot flow execution
 */
export const queueChatbotFlowSchema = z.object({
  conversationId: z.string().min(1, 'Conversation ID is required'),
  userMessage: z.string().optional(),
  triggerType: z.enum([
    'message',
    'delay',
    'timeout',
    'deliver_part',
    'follow_up',
    'expire',
    'booking_fallback',
  ]),
  /** Delay in milliseconds before executing (for delay nodes and response timeouts) */
  delayMs: z.number().int().min(0).default(0),
  /** For deliver_part: the message parts to deliver */
  pendingMessageParts: z.array(z.string()).optional(),
  /** For deliver_part: the current part index to deliver */
  currentPartIndex: z.number().int().min(0).optional(),
  /** When true, bot messages are saved to DB but not sent via external API (for E2E testing) */
  skipExternalDelivery: z.boolean().optional(),
});

export type QueueChatbotFlowInput = z.infer<typeof queueChatbotFlowSchema>;
