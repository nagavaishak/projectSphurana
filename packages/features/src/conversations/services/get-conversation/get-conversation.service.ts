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
  type GetConversationInput,
  getConversationSchema,
} from './get-conversation.schema.js';

const getConversationImpl = async (
  db: DbConnection,
  input: GetConversationInput
): Promise<Result<typeof conversation.$inferSelect>> => {
  const parsed = getConversationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const result = await db.query.conversation.findFirst({
    where: and(
      eq(conversation.id, parsed.data.id),
      eq(conversation.organizationId, parsed.data.organizationId)
    ),
  });

  if (!result) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
    );
  }

  return ok(result);
};

export const getConversation = (
  db: DbConnection,
  input: GetConversationInput
) =>
  trackedResult(
    'conversations.getConversation',
    () => withOrgScope((tx) => getConversationImpl(tx, input), { db }),
    { properties: { id: input.id }, internalErrorsOnly: true }
  );

export type GetConversationResult = Awaited<ReturnType<typeof getConversation>>;
