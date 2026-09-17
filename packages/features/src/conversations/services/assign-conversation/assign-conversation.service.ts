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
  type AssignConversationInput,
  assignConversationSchema,
} from './assign-conversation.schema.js';

const assignConversationImpl = async (
  db: DbConnection,
  input: AssignConversationInput
): Promise<Result<typeof conversation.$inferSelect>> => {
  const parsed = assignConversationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const [result] = await db
    .update(conversation)
    .set({
      assignedToId: parsed.data.assignToUserId,
      status: 'agent_handling',
    })
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

  return ok(result);
};

export const assignConversation = (
  db: DbConnection,
  input: AssignConversationInput
) =>
  trackedResult(
    'conversations.assignConversation',
    () => withOrgScope((tx) => assignConversationImpl(tx, input), { db }),
    {
      properties: { id: input.id, assignToUserId: input.assignToUserId },
    }
  );

export type AssignConversationResult = Awaited<
  ReturnType<typeof assignConversation>
>;
