import type {
  AssistantConversation,
  AssistantConversationWithMessages,
  AssistantMessage,
  CreateConversationInput,
} from '@borradh-workspace/api-client/types';
import type { UIMessage } from 'ai';

/**
 * Session data returned by the NestJS API auth endpoint.
 * Re-exported from the app's session module for convenience.
 */
export type { SessionResponse } from '@/lib/session';

/**
 * Chat message type for the assistant.
 * Uses the base UIMessage from the AI SDK.
 */
export type ChatMessage = UIMessage;

/**
 * Request body for the streaming chat endpoint.
 */
export interface ChatRequestBody {
  messages: ChatMessage[];
  conversationId?: string;
}

/**
 * Conversation summary for list views.
 * Derived from the shared AssistantConversation type.
 */
export type ConversationSummary = AssistantConversation;

/**
 * Full conversation with messages.
 * Derived from the shared AssistantConversationWithMessages type.
 */
export type ConversationWithMessages = AssistantConversationWithMessages;

/**
 * Stored message from DB.
 * Derived from the shared AssistantMessage type.
 */
export type StoredMessage = AssistantMessage;

/**
 * Create conversation request body.
 * Derived from the shared CreateConversationInput type.
 */
export type CreateConversationBody = CreateConversationInput;
