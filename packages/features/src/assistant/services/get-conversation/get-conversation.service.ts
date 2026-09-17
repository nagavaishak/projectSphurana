import {
  and,
  asc,
  assistantConversation,
  assistantMessage,
  eq,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type GetConversationInput,
  getConversationSchema,
} from './get-conversation.schema.js';

export interface ConversationMessage {
  id: string;
  role: string;
  content: string | null;
  toolCalls: unknown;
  toolResults: unknown;
  attachments: unknown;
  createdAt: Date;
}

export interface ConversationWithMessages {
  id: string;
  title: string | null;
  status: 'active' | 'escalated';
  escalatedAt: Date | null;
  escalationReason: string | null;
  /**
   * Skills loaded into this conversation (intent classifier first turn +
   * `load_skill` mid-conversation pivots). Empty array = "default skill
   * only" — `'default'` is implicit and never persisted (W-C03-D-finish).
   * Pre-W-C03-D-prep rows had this column NULL; the migration backfilled
   * to `[]`, so callers can treat empty as the "no extra skills" baseline.
   */
  loadedSkillIds: string[];
  /**
   * Skill registry version this conversation was pinned to on creation
   * (claire.md §2 Q31b). The orchestrator uses this to detect drift after
   * a registry bump; in-flight conversations don't auto-upgrade.
   */
  skillRegistryVersion: number;
  createdAt: Date;
  updatedAt: Date;
  messages: ConversationMessage[];
}

const getConversationImpl = async (
  db: DbConnection,
  input: GetConversationInput
): Promise<Result<ConversationWithMessages>> => {
  const parsed = getConversationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, userId } = parsed.data;

  try {
    const { conversation, messages } = await withOrgScope(
      async (tx) => {
        const conversation = await tx.query.assistantConversation.findFirst({
          where: and(
            eq(assistantConversation.id, id),
            eq(assistantConversation.organizationId, organizationId),
            eq(assistantConversation.userId, userId),
            notDeleted(assistantConversation)
          ),
          columns: {
            id: true,
            title: true,
            status: true,
            escalatedAt: true,
            escalationReason: true,
            loadedSkillIds: true,
            skillRegistryVersion: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        // assistant_message is Bucket B (child-of-org) — scoped via the parent
        // conversation check above; no separate withOrgScope needed for messages.
        const messages = conversation
          ? await tx.query.assistantMessage.findMany({
              where: eq(assistantMessage.conversationId, id),
              orderBy: [asc(assistantMessage.createdAt)],
              columns: {
                id: true,
                role: true,
                content: true,
                toolCalls: true,
                toolResults: true,
                attachments: true,
                createdAt: true,
              },
            })
          : [];
        return { conversation, messages };
      },
      { db }
    );

    if (!conversation) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
      );
    }

    return ok({ ...conversation, messages });
  } catch (error) {
    logError('assistant.getConversation', error, {
      feature: 'assistant',
      extra: { id, organizationId, userId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to load conversation')
    );
  }
};

export const getConversation = (
  db: DbConnection,
  input: GetConversationInput
) =>
  trackedResult(
    'assistant.getConversation',
    () => getConversationImpl(db, input),
    {
      properties: { id: input.id, organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );
