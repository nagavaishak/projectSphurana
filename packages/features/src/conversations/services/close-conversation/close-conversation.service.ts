import { conversation } from '@borradh-workspace/database';
import { withOrgScope } from '@borradh-workspace/database';
import { trackOrgEvent, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CloseConversationInput,
  closeConversationSchema,
} from './close-conversation.schema.js';

const closeConversationImpl = async (
  db: DbConnection,
  input: CloseConversationInput
): Promise<Result<typeof conversation.$inferSelect>> => {
  const parsed = closeConversationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const [result] = await db
    .update(conversation)
    .set({ status: 'closed', closedAt: new Date() })
    .where(
      and(
        eq(conversation.id, parsed.data.id),
        eq(conversation.organizationId, parsed.data.organizationId)
      )
    )
    .returning();

  if (!result) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
    );
  }

  trackOrgEvent(result.organizationId, 'conversation_closed', {
    conversationId: result.id,
    platform: result.platform,
  });

  return ok(result);
};

export const closeConversation = (
  db: DbConnection,
  input: CloseConversationInput
) =>
  trackedResult(
    'conversations.closeConversation',
    () => withOrgScope((tx) => closeConversationImpl(tx, input), { db }),
    { properties: { id: input.id } }
  );

export type CloseConversationResult = Awaited<
  ReturnType<typeof closeConversation>
>;
