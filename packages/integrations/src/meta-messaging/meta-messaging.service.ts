import { fetchWithRetry } from '@borradh-workspace/http';
import { createLogger, logError } from '@borradh-workspace/observability';
import { GRAPH_API_BASE, GRAPH_API_VERSION } from '../shared/graph-api.js';
import {
  MetaApiError,
  type MetaErrorResponse,
  extractMetaErrorContext,
  parseMetaErrorResponse,
} from '../shared/meta-api-error.js';
import { metaPageSubscribedFields } from '../webhooks/index.js';
import type {
  ConversationMessagePair,
  MetaConversationMessage,
  MetaConversationMessagesResponse,
  MetaConversationsListResponse,
  MetaMessagingCredentials,
  MetaQuickReply,
  MetaSendMessageResponse,
  MetaSenderAction,
  MetaUserProfile,
} from './meta-messaging.types.js';

const logger = createLogger('meta-messaging');

/**
 * Service for Meta Messaging API operations
 * Handles sending messages via the Facebook Messenger / Instagram DM Send API
 */
export class MetaMessagingService {
  private pageAccessToken: string;
  private pageId: string;
  private graphApiBase: string;

  constructor(credentials: MetaMessagingCredentials) {
    this.pageAccessToken = credentials.pageAccessToken;
    this.pageId = credentials.pageId;
    this.graphApiBase = credentials.graphApiBase
      ? `${credentials.graphApiBase}/${GRAPH_API_VERSION}`
      : GRAPH_API_BASE;
  }

  // ==================== HELPER METHODS ====================

  private async apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${this.graphApiBase}${endpoint}`;

    const separator = url.includes('?') ? '&' : '?';
    const urlWithToken = `${url}${separator}access_token=${this.pageAccessToken}`;

    const response = await fetchWithRetry(urlWithToken, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      timeoutMs: 15000,
      retries: 2,
      onRetry: ({ attempt, delayMs, status, error }) => {
        logger.warn('Retrying Meta Messaging API request', {
          endpoint: endpoint.split('?')[0],
          attempt,
          delayMs,
          status,
          error: error instanceof Error ? error.message : undefined,
        });
      },
    });

    if (!response.ok) {
      const error = await parseMetaErrorResponse(
        response,
        `Meta Messaging API request to ${endpoint.split('?')[0]} failed`
      );
      this.logApiError(error, {
        endpoint: endpoint.split('?')[0],
        status: response.status,
        ...extractMetaErrorContext(error),
      });
      throw error;
    }

    const data = (await response.json()) as T & {
      error?: { message?: string };
    };

    // Handle HTTP 200 with error object in body (Meta does this occasionally)
    if (data && typeof data === 'object' && 'error' in data && data.error) {
      const error = new MetaApiError(
        data as unknown as MetaErrorResponse,
        `Meta Messaging API request to ${endpoint.split('?')[0]} failed`
      );
      this.logApiError(error, {
        endpoint: endpoint.split('?')[0],
        status: response.status,
        bodyError: true,
        ...extractMetaErrorContext(error),
      });
      throw error;
    }

    return data;
  }

  /**
   * Log a Meta API error at the appropriate severity. Expected, user/recipient-
   * side conditions (dead token, deleted conversation, blocked recipient, …)
   * are logged at `warn` so they don't trip infra error-rate alerts — they're
   * surfaced to the org through other channels (e.g. `needs_reconnect`). Only
   * genuinely unexpected failures (transient/rate-limit/unknown) log at `error`.
   */
  private logApiError(
    error: MetaApiError,
    extra: Record<string, unknown>
  ): void {
    if (error.isExpected) {
      // Expected, user/recipient-side conditions (dead token, deleted
      // conversation, blocked recipient, …) are logged at `warn` via the
      // structured Pino logger ONLY — never routed to Sentry — so they don't
      // inflate the error tracker. The org is told through other channels
      // (e.g. `needs_reconnect`).
      logger.warn(`metaMessaging.apiRequest: ${error.message}`, {
        feature: 'meta-messaging',
        ...extra,
      });
      return;
    }
    logError('metaMessaging.apiRequest', error, {
      feature: 'meta-messaging',
      extra,
    });
  }

  // ==================== MESSAGING METHODS ====================

  /**
   * Parse Meta's snake_case Send API response into our camelCase type.
   * Meta returns { recipient_id, message_id } — we map to { recipientId, messageId }.
   */
  private parseSendResponse(
    raw: Record<string, unknown>
  ): MetaSendMessageResponse {
    return {
      recipientId:
        (raw.recipient_id as string) ?? (raw.recipientId as string) ?? '',
      messageId: (raw.message_id as string) ?? (raw.messageId as string) ?? '',
    };
  }

  private get platformCharLimit(): number {
    return this.graphApiBase.includes('instagram') ? 1000 : 2000;
  }

  private truncateText(text: string): string {
    const limit = this.platformCharLimit;
    if (text.length <= limit) return text;
    return `${text.slice(0, limit - 1)}…`;
  }

  /**
   * Send a text message to a user
   */
  async sendTextMessage(
    recipientId: string,
    text: string
  ): Promise<MetaSendMessageResponse> {
    const payload = {
      recipient: { id: recipientId },
      message: { text: this.truncateText(text) },
      messaging_type: 'RESPONSE',
    };

    const raw = await this.apiRequest<Record<string, unknown>>('/me/messages', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return this.parseSendResponse(raw);
  }

  /**
   * Send a message with quick reply buttons
   */
  async sendQuickReply(
    recipientId: string,
    text: string,
    options: MetaQuickReply[]
  ): Promise<MetaSendMessageResponse> {
    // Meta API expects snake_case keys in the JSON payload
    const payload = {
      recipient: { id: recipientId },
      message: {
        text: this.truncateText(text),
        quick_replies: options.map((opt) => ({
          content_type: opt.contentType,
          title: opt.title,
          payload: opt.payload,
        })),
      },
      messaging_type: 'RESPONSE',
    };

    const raw = await this.apiRequest<Record<string, unknown>>('/me/messages', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return this.parseSendResponse(raw);
  }

  /**
   * Send a media attachment (image, video, audio, file)
   */
  async sendAttachment(
    recipientId: string,
    type: 'image' | 'audio' | 'video' | 'file',
    url: string
  ): Promise<MetaSendMessageResponse> {
    const payload = {
      recipient: { id: recipientId },
      message: {
        attachment: {
          type,
          payload: { url, is_reusable: true },
        },
      },
      messaging_type: 'RESPONSE',
    };

    const raw = await this.apiRequest<Record<string, unknown>>('/me/messages', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return this.parseSendResponse(raw);
  }

  /**
   * Send a typing indicator or mark as seen
   */
  async sendSenderAction(
    recipientId: string,
    action: MetaSenderAction
  ): Promise<void> {
    await this.apiRequest('/me/messages', {
      method: 'POST',
      body: JSON.stringify({
        recipient: { id: recipientId },
        sender_action: action,
      }),
    });
  }

  /**
   * Convenience method for typing indicator
   */
  async sendTypingIndicator(recipientId: string, on: boolean): Promise<void> {
    await this.sendSenderAction(recipientId, on ? 'typing_on' : 'typing_off');
  }

  // ==================== USER PROFILE ====================

  /**
   * Get user profile information.
   * Instagram-scoped user IDs only support `name` and `profile_pic` fields;
   * requesting `first_name`/`last_name` on an IGSID causes a Graph API error.
   */
  async getUserProfile(
    userId: string,
    platform?: 'facebook_messenger' | 'instagram_dm'
  ): Promise<MetaUserProfile> {
    const fields =
      platform === 'instagram_dm'
        ? 'id,name,profile_pic'
        : 'id,name,first_name,last_name,profile_pic';
    return this.apiRequest<MetaUserProfile>(`/${userId}?fields=${fields}`);
  }

  // ==================== CONVERSATION HISTORY ====================

  /**
   * Fetch message history for a conversation with a specific user.
   * Uses the Page Conversations API: GET /{page-id}/conversations
   * Instagram conversations require the `platform=instagram` parameter.
   */
  async getConversationMessages(
    userId: string,
    platform?: 'facebook_messenger' | 'instagram_dm'
  ): Promise<MetaConversationMessage[]> {
    try {
      return await this.getConversationMessagesOrThrow(userId, platform);
    } catch (error) {
      // `apiRequest` already logs every MetaApiError at the right severity, so
      // re-logging here would just double the volume. Only log errors it didn't
      // see — e.g. network/timeout failures thrown before a response.
      if (!(error instanceof MetaApiError)) {
        logError('metaMessaging.getConversationMessages', error, {
          feature: 'meta-messaging',
          extra: { userId, platform, pageId: this.pageId },
        });
      }
      return [];
    }
  }

  /**
   * Same as `getConversationMessages` but propagates errors instead of
   * swallowing them. Use this when the caller needs to distinguish
   * "no prior history" from "lookup failed" (e.g. a check that must fail
   * closed on lookup errors rather than treat them as an empty history).
   */
  async getConversationMessagesOrThrow(
    userId: string,
    platform?: 'facebook_messenger' | 'instagram_dm'
  ): Promise<MetaConversationMessage[]> {
    const platformParam =
      platform === 'instagram_dm' ? '&platform=instagram' : '';
    // Request non-text fields too (attachments/sticker/shares) so stickers and
    // media in history aren't backfilled as blank bubbles. Meta ignores fields
    // it doesn't support for a given platform rather than erroring.
    const response = await this.apiRequest<MetaConversationMessagesResponse>(
      `/${this.pageId}/conversations?user_id=${userId}${platformParam}&fields=messages{message,from,created_time,attachments,sticker,shares}`
    );

    if (!response.data?.length) return [];

    const conv = response.data[0];
    return conv.messages?.data ?? [];
  }

  // ==================== BULK CONVERSATION FETCH ====================

  /**
   * Fetch ALL historical conversations for a page and extract message pairs.
   * Paginates through all conversations following cursor-based pagination.
   * Used for voice cloning to gather customer/business message pairs.
   *
   * @param options.limit - Maximum number of conversations to fetch (default 1000)
   * @returns Array of customer message / business reply pairs
   */
  async getAllPageConversations(
    options: { limit?: number } = {}
  ): Promise<ConversationMessagePair[]> {
    const maxConversations = options.limit ?? 1000;
    const pairs: ConversationMessagePair[] = [];
    let fetched = 0;

    let url = `/${this.pageId}/conversations?fields=messages.limit(100){message,from,created_time}&limit=50`;

    while (fetched < maxConversations) {
      const response =
        await this.apiRequest<MetaConversationsListResponse>(url);

      if (!response.data?.length) break;

      for (const conversation of response.data) {
        if (fetched >= maxConversations) break;
        fetched++;

        const messages = conversation.messages?.data;
        if (!messages?.length) continue;

        // Messages are in reverse chronological order (newest first).
        // Reverse to process oldest-first for pairing.
        const chronological = [...messages].reverse();

        for (let i = 0; i < chronological.length - 1; i++) {
          const current = chronological[i];
          const next = chronological[i + 1];

          // Look for customer message followed by page reply
          const isCustomerMessage = current.from.id !== this.pageId;
          const isPageReply = next.from.id === this.pageId;

          if (
            isCustomerMessage &&
            isPageReply &&
            current.message &&
            next.message
          ) {
            pairs.push({
              customerMessage: current.message,
              businessReply: next.message,
              timestamp: new Date(current.created_time),
              conversationId: conversation.id,
            });
          }
        }
      }

      // Follow pagination cursor if available
      if (!response.paging?.next) break;
      url = response.paging.next;

      // Rate limit: 1 second delay between pagination requests
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return pairs;
  }

  // ==================== PAGE SUBSCRIPTION ====================

  /**
   * Subscribe page to messaging webhook events
   * Must be called after connecting a page to enable receiving messages
   */
  async subscribeToMessaging(): Promise<{ success: boolean }> {
    return this.apiRequest<{ success: boolean }>(
      `/${this.pageId}/subscribed_apps`,
      {
        method: 'POST',
        body: JSON.stringify({
          subscribed_fields: metaPageSubscribedFields,
        }),
      }
    );
  }
}
