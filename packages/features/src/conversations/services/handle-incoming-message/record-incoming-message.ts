import { randomUUID } from 'node:crypto';
import {
  type ConversationMessageMetadata,
  conversationMessage,
} from '@borradh-workspace/database';
import { eq } from 'drizzle-orm';

import type { DbConnection } from '../../../shared/index.js';
import type { DerivedMessageType } from './derive-message-content.js';

export async function recordIncomingMessage(
  db: DbConnection,
  input: {
    conversationId: string;
    externalMessageId?: string;
    /** Display content — never blank (see deriveMessageContent). */
    content: string;
    /** Persisted message_type. Defaults to 'text'. */
    messageType?: DerivedMessageType;
    /** Structured sticker/reaction/attachment payload, or null for plain text. */
    metadata?: ConversationMessageMetadata | null;
    timestamp?: number;
  }
): Promise<{ id: string; alreadyExists: boolean }> {
  if (!input.content?.trim()) {
    return { id: randomUUID(), alreadyExists: true };
  }

  if (input.externalMessageId) {
    const existingMsg = await db.query.conversationMessage.findFirst({
      where: eq(conversationMessage.externalMessageId, input.externalMessageId),
    });

    if (existingMsg) {
      return { id: existingMsg.id, alreadyExists: true };
    }
  }

  const result = await db
    .insert(conversationMessage)
    .values({
      conversationId: input.conversationId,
      role: 'user',
      content: input.content,
      messageType: input.messageType ?? 'text',
      metadata: input.metadata ?? null,
      externalMessageId: input.externalMessageId,
      origin: 'live',
      sentAt: input.timestamp ? new Date(input.timestamp) : new Date(),
    })
    .onConflictDoNothing()
    .returning();

  if (!result.length) {
    if (input.externalMessageId) {
      const existing = await db.query.conversationMessage.findFirst({
        where: eq(
          conversationMessage.externalMessageId,
          input.externalMessageId
        ),
      });
      if (existing) return { id: existing.id, alreadyExists: true };
    }
    return { id: randomUUID(), alreadyExists: true };
  }

  return { id: result[0].id, alreadyExists: false };
}
