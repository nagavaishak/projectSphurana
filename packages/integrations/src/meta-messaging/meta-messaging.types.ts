/**
 * Credentials for Meta Messaging API
 * Uses page-level access token (from metaAdsPage.pageAccessToken)
 */
export interface MetaMessagingCredentials {
  /** Page access token with messaging permissions */
  pageAccessToken: string;
  /** Facebook Page ID */
  pageId: string;
  /** Override Graph API base URL (e.g. 'https://graph.instagram.com' for standalone Instagram) */
  graphApiBase?: string;
}

/**
 * Recipient for Send API
 */
export interface MetaRecipient {
  /** Platform-Scoped User ID (PSID for Messenger, IGSID for Instagram) */
  id: string;
}

/**
 * Quick reply button
 */
export interface MetaQuickReply {
  contentType: 'text';
  title: string;
  payload: string;
}

/**
 * Send API message payload
 */
export interface MetaSendMessagePayload {
  recipient: MetaRecipient;
  message: {
    text?: string;
    quickReplies?: MetaQuickReply[];
    attachment?: {
      type: 'image' | 'audio' | 'video' | 'file';
      payload: {
        url: string;
        isReusable?: boolean;
      };
    };
  };
  messagingType?: 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG';
}

/**
 * Send API response
 */
export interface MetaSendMessageResponse {
  recipientId: string;
  messageId: string;
}

/**
 * Sender action types (typing indicators)
 */
export type MetaSenderAction = 'typing_on' | 'typing_off' | 'mark_seen';

/**
 * User profile data from Meta
 */
export interface MetaUserProfile {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  profilePic?: string;
}

/**
 * Incoming webhook messaging event (from Meta)
 */
export interface MetaMessagingWebhookEntry {
  id: string;
  time: number;
  messaging?: MetaMessagingEvent[];
}

/**
 * Individual messaging event
 */
export interface MetaMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: Array<{
      type: string;
      payload: { url?: string };
    }>;
    quickReply?: { payload: string };
  };
  postback?: {
    title: string;
    payload: string;
  };
  delivery?: {
    mids: string[];
    watermark: number;
  };
  read?: {
    watermark: number;
  };
  referral?: {
    ref?: string;
    source?: string;
    type?: string;
    ad_id?: string;
    ads_context_data?: {
      ad_title?: string;
      photo_url?: string;
      video_url?: string;
      post_id?: string;
    };
  };
}

/**
 * Full webhook payload from Meta
 */
export interface MetaMessagingWebhookPayload {
  object: 'page' | 'instagram';
  entry: MetaMessagingWebhookEntry[];
}

/**
 * An attachment as returned by the Conversations API message edge. Media URLs
 * live under `image_data` / `video_data` / `file_url`; `mime_type`/`name`
 * describe files. (Distinct from the Send/webhook attachment shape.)
 */
export interface MetaConversationAttachment {
  id?: string;
  mime_type?: string;
  name?: string;
  image_data?: { url?: string; preview_url?: string };
  video_data?: { url?: string };
  file_url?: string;
}

/**
 * A single message from the Conversations API.
 *
 * `attachments`, `sticker` and `shares` are only present when requested in the
 * `fields=` set and supported for the platform — non-text messages otherwise
 * arrive with an empty `message` string.
 */
export interface MetaConversationMessage {
  id: string;
  message: string;
  from: { name: string; email: string; id: string };
  created_time: string;
  /** Media/file attachments. */
  attachments?: { data: MetaConversationAttachment[] };
  /** Sticker image URL (the Conversations API exposes a URL, not an id). */
  sticker?: string;
  /** Shared links/posts. */
  shares?: { data: Array<{ id?: string; link?: string; name?: string }> };
}

/**
 * Response from the Conversations API when fetching messages
 */
export interface MetaConversationMessagesResponse {
  data: Array<{
    id: string;
    messages: {
      data: MetaConversationMessage[];
    };
  }>;
}

/**
 * Response from the Conversations API when listing all conversations for a page
 */
export interface MetaConversationsListResponse {
  data: Array<{
    id: string;
    messages?: {
      data: Array<{
        id: string;
        message: string;
        from: { name: string; id: string };
        created_time: string;
      }>;
      paging?: { cursors: { after: string }; next?: string };
    };
  }>;
  paging?: { cursors: { after: string }; next?: string };
}

/**
 * A paired customer message and business reply from a conversation
 */
export interface ConversationMessagePair {
  customerMessage: string;
  businessReply: string;
  timestamp: Date;
  conversationId: string;
}
