/**
 * The editor-sidebar transcript.
 *
 * Every read and write here carries BOTH the conversation id and the session's
 * organization in the WHERE clause. A conversation id is a guessable-looking
 * string in a URL (`GET microsites/:id/conversations/:cid`), so the org
 * predicate is what makes it safe to expose — not the id's entropy.
 */

import {
  micrositeConversation,
  micrositeMessage,
} from '@borradh-workspace/database';
import type { MicrositeToolCall } from '@borradh-workspace/database';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../shared/index.js';
import { loadOwnedMicrosite } from '../services/shared/authorize.js';
import type { MicrositeAgentSession } from './types.js';

export interface MicrositeTranscriptMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls: MicrositeToolCall[] | null;
  revisionId: string | null;
  createdAt: Date;
}

/**
 * Resolve the conversation for a turn, creating one when the sidebar opens a
 * new thread. Ownership is re-checked here rather than trusted from the
 * controller (plan §12).
 */
export const resolveConversation = async (
  db: DbConnection,
  session: MicrositeAgentSession,
  conversationId?: string
): Promise<Result<{ id: string; created: boolean }>> => {
  const owned = await loadOwnedMicrosite(
    db,
    session.micrositeId,
    session.organizationId
  );
  if (!owned.success) return err(owned.error);

  if (conversationId) {
    const existing = await db.query.micrositeConversation.findFirst({
      where: and(
        eq(micrositeConversation.id, conversationId),
        eq(micrositeConversation.micrositeId, session.micrositeId),
        eq(micrositeConversation.organizationId, session.organizationId)
      ),
      columns: { id: true },
    });
    if (!existing) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
      );
    }
    return ok({ id: existing.id, created: false });
  }

  const [row] = await db
    .insert(micrositeConversation)
    .values({
      micrositeId: session.micrositeId,
      organizationId: session.organizationId,
      userId: session.userId,
      lastMessageAt: new Date(),
    })
    .returning({ id: micrositeConversation.id });

  return ok({ id: row.id, created: true });
};

/** Newest `limit` turns, oldest-first — the order the model wants them in. */
export const loadRecentMessages = async (
  db: DbConnection,
  session: MicrositeAgentSession,
  conversationId: string,
  limit: number
): Promise<MicrositeTranscriptMessage[]> => {
  const rows = await db.query.micrositeMessage.findMany({
    where: and(
      eq(micrositeMessage.conversationId, conversationId),
      eq(micrositeMessage.organizationId, session.organizationId)
    ),
    orderBy: [desc(micrositeMessage.createdAt)],
    limit,
  });

  return [...rows].reverse().map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    toolCalls: row.toolCalls ?? null,
    revisionId: row.revisionId,
    createdAt: row.createdAt,
  }));
};

/** The whole transcript, oldest-first — backs `GET .../conversations/:cid`. */
export const loadTranscript = async (
  db: DbConnection,
  session: MicrositeAgentSession,
  conversationId: string
): Promise<
  Result<{ conversationId: string; messages: MicrositeTranscriptMessage[] }>
> => {
  const conversation = await resolveConversation(db, session, conversationId);
  if (!conversation.success) return err(conversation.error);

  const rows = await db.query.micrositeMessage.findMany({
    where: and(
      eq(micrositeMessage.conversationId, conversationId),
      eq(micrositeMessage.organizationId, session.organizationId)
    ),
    orderBy: [asc(micrositeMessage.createdAt)],
  });

  return ok({
    conversationId,
    messages: rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      toolCalls: row.toolCalls ?? null,
      revisionId: row.revisionId,
      createdAt: row.createdAt,
    })),
  });
};

export const appendMessage = async (
  db: DbConnection,
  session: MicrositeAgentSession,
  input: {
    conversationId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    toolCalls?: MicrositeToolCall[];
    revisionId?: string | null;
  }
): Promise<Result<{ id: string }>> => {
  const [row] = await db
    .insert(micrositeMessage)
    .values({
      conversationId: input.conversationId,
      // Denormalized from the conversation so `orgRlsPolicy` applies.
      organizationId: session.organizationId,
      role: input.role,
      content: input.content,
      toolCalls: input.toolCalls ?? null,
      revisionId: input.revisionId ?? null,
    })
    .returning({ id: micrositeMessage.id });

  await db
    .update(micrositeConversation)
    .set({ lastMessageAt: new Date() })
    .where(
      and(
        eq(micrositeConversation.id, input.conversationId),
        eq(micrositeConversation.organizationId, session.organizationId)
      )
    );

  return ok({ id: row.id });
};
