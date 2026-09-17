import { conversation, conversationMessage } from '@borradh-workspace/database';
import { withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, asc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListMessagesInput,
  listMessagesSchema,
} from './list-messages.schema.js';

const listMessagesImpl = async (
  db: DbConnection,
  input: ListMessagesInput
): Promise<
  Result<{
    items: (typeof conversationMessage.$inferSelect)[];
    total: number;
  }>
> => {
  const parsed = listMessagesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Verify conversation belongs to organization
  const conv = await db.query.conversation.findFirst({
    where: and(
      eq(conversation.id, parsed.data.conversationId),
      eq(conversation.organizationId, parsed.data.organizationId)
    ),
  });

  if (!conv) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
    );
  }

  const messages = await db.query.conversationMessage.findMany({
    where: eq(conversationMessage.conversationId, parsed.data.conversationId),
    limit: parsed.data.limit,
    offset: parsed.data.offset,
    orderBy: [
      asc(conversationMessage.sentAt),
      asc(conversationMessage.createdAt),
    ],
  });

  return ok({ items: messages, total: messages.length });
};

export const listMessages = (db: DbConnection, input: ListMessagesInput) =>
  trackedResult(
    'conversations.listMessages',
    () => withOrgScope((tx) => listMessagesImpl(tx, input), { db }),
    { properties: { conversationId: input.conversationId } }
  );

export type ListMessagesResult = Awaited<ReturnType<typeof listMessages>>;
