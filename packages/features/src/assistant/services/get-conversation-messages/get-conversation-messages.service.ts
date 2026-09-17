import { assistantMessage, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { ConversationMessage } from '../get-conversation/get-conversation.service.js';
import {
  type GetConversationMessagesInput,
  getConversationMessagesSchema,
} from './get-conversation-messages.schema.js';

/**
 * Load the most-recent `limit` messages for a conversation, returned in
 * ascending (chronological) order.
 *
 * Why this exists: the WhatsApp worker has no client to resend the thread (the
 * web `useChat` posts the whole conversation each request), so it must rebuild
 * turn history from the DB. The web controller bounds history implicitly (the
 * client only keeps so much); here the thread is one persistent, ever-growing
 * conversation, so we bound it explicitly with a most-recent-N window to keep
 * the Anthropic prompt from growing unbounded (cost/latency/limit). We fetch
 * `desc` + `limit` at the DB so we only pull the tail, then reverse to
 * chronological order for the converter.
 *
 * Message granularity is safe for tool pairing: each assistant row carries its
 * own `toolCalls`/`toolResults`, and the stored→Anthropic converter reconstructs
 * both the `tool_use` and the matching `tool_result` from that single row, so a
 * window boundary never splits a tool pair.
 */
const getConversationMessagesImpl = async (
  db: DbConnection,
  input: GetConversationMessagesInput
): Promise<Result<ConversationMessage[]>> => {
  const parsed = getConversationMessagesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { conversationId, limit } = parsed.data;

  try {
    // assistant_message is Bucket B (child-of-org); the caller scopes by the
    // parent conversation id (already resolved for this org/user), matching
    // get-conversation's read pattern.
    const rows = await withOrgScope(
      async (tx) =>
        tx.query.assistantMessage.findMany({
          where: eq(assistantMessage.conversationId, conversationId),
          orderBy: [desc(assistantMessage.createdAt)],
          limit,
          columns: {
            id: true,
            role: true,
            content: true,
            toolCalls: true,
            toolResults: true,
            attachments: true,
            createdAt: true,
          },
        }),
      { db }
    );

    // Reverse the most-recent-N tail back into chronological order.
    return ok([...rows].reverse() as ConversationMessage[]);
  } catch (error) {
    logError('assistant.getConversationMessages', error, {
      feature: 'assistant',
      extra: { conversationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to load conversation messages'
      )
    );
  }
};

export const getConversationMessages = (
  db: DbConnection,
  input: GetConversationMessagesInput
) =>
  trackedResult(
    'assistant.getConversationMessages',
    () => getConversationMessagesImpl(db, input),
    {
      properties: { conversationId: input.conversationId },
      internalErrorsOnly: true,
    }
  );

export type GetConversationMessagesResult = Awaited<
  ReturnType<typeof getConversationMessages>
>;
