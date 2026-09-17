import { conversation } from '@borradh-workspace/database';
import { withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
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
  type DeleteConversationInput,
  deleteConversationSchema,
} from './delete-conversation.schema.js';

const deleteConversationImpl = async (
  db: DbConnection,
  input: DeleteConversationInput
): Promise<Result<{ success: true }>> => {
  const parsed = deleteConversationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const [result] = await db
    .delete(conversation)
    .where(
      and(
        eq(conversation.id, parsed.data.id),
        eq(conversation.organizationId, parsed.data.organizationId)
      )
    )
    .returning({ id: conversation.id });

  if (!result) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
    );
  }

  return ok({ success: true as const });
};

export const deleteConversation = (
  db: DbConnection,
  input: DeleteConversationInput
) =>
  trackedResult(
    'conversations.deleteConversation',
    () => withOrgScope((tx) => deleteConversationImpl(tx, input), { db }),
    { properties: { id: input.id } }
  );

export type DeleteConversationResult = Awaited<
  ReturnType<typeof deleteConversation>
>;
