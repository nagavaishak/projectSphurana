import type {
  Conversation,
  ConversationMessage,
} from '@borradh-workspace/database';

/**
 * Conversation with latest message preview
 */
export interface ConversationWithPreview extends Conversation {
  lastMessage: {
    content: string;
    role: string;
    createdAt: Date;
  } | null;
  unreadCount: number;
}

/**
 * Conversation with full message list
 */
export interface ConversationWithMessages extends Conversation {
  messages: ConversationMessage[];
}
