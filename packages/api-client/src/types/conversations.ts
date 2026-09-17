/**
 * @borradh-workspace/api-client - Conversation API Types
 *
 * Types for the conversations API endpoints.
 * Types are derived from backend packages - database enums and features schemas.
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  ConversationStatus,
  MessageRole,
  MessageType,
  MessagingPlatform,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  conversationStatusLabels,
  conversationStatusValues,
  messageRoleLabels,
  messageRoleValues,
  messageTypeLabels,
  messageTypeValues,
  messagingPlatformLabels,
  messagingPlatformValues,
} from '@borradh-workspace/features/shared';

// Import backend types from features
import type {
  Conversation as BackendConversation,
  ConversationMessage as BackendConversationMessage,
  ListConversationsInput as BackendListConversationsInput,
  SendMessageInput as BackendSendMessageInput,
} from '@borradh-workspace/features/conversations';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// ============================================================================

export type { ConversationStatus };
export type { MessageRole };
export type { MessageType };
export type { MessagingPlatform };

// Re-export labels and values for frontend use
export {
  conversationStatusLabels,
  conversationStatusValues,
  messageRoleLabels,
  messageRoleValues,
  messageTypeLabels,
  messageTypeValues,
  messagingPlatformLabels,
  messagingPlatformValues,
};

// ============================================================================
// ENTITY TYPES - Serialized for API responses
// ============================================================================

export type Conversation = Serialize<BackendConversation>;

export type ConversationMessage = Serialize<BackendConversationMessage>;

export interface ConversationWithPreview extends Conversation {
  lastMessage?: string | null;
  unreadCount?: number;
}

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

export type ListConversationsParams = Omit<
  BackendListConversationsInput,
  'organizationId'
>;

export type SendMessageInput = Omit<
  BackendSendMessageInput,
  'conversationId' | 'organizationId' | 'userId'
>;

// ============================================================================
// RESPONSE TYPES
// ============================================================================

export interface ConversationListItem extends Conversation {
  lastMessageContent: string | null;
  lastMessageRole: string | null;
}

export interface ListConversationsResponse {
  items: ConversationListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListMessagesResponse {
  items: ConversationMessage[];
  limit: number;
  offset: number;
}
