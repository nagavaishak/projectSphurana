import {
  type ConversationMetadata,
  conversation,
  conversationMessage,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq, sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { describeHighIntent } from '../shared/index.js';
import {
  type ConversationIntentReport,
  type InspectConversationIntentInput,
  inspectConversationIntentSchema,
} from './inspect-conversation-intent.schema.js';

/**
 * Inspect one conversation's CTWA attribution + high-intent verdict (PRD-1
 * follow-up — live testability). Pure read; reuses the shared predicate so the
 * verdict here matches what `diagnoseCampaign` / the trigger see.
 */
const inspectConversationIntentImpl = async (
  db: DbConnection,
  input: InspectConversationIntentInput
): Promise<Result<ConversationIntentReport>> => {
  const parsed = inspectConversationIntentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const data = parsed.data;

  try {
    const row = await db.query.conversation.findFirst({
      where: data.conversationId
        ? eq(conversation.id, data.conversationId)
        : and(
            eq(conversation.organizationId, data.organizationId as string),
            eq(conversation.platform, data.platform as never),
            eq(conversation.externalUserId, data.externalUserId as string)
          ),
    });

    if (!row) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
      );
    }

    const countResult = await db.execute(sql<{ count: number | string }[]>`
      SELECT COUNT(*)::int AS "count"
      FROM ${conversationMessage}
      WHERE ${conversationMessage.conversationId} = ${row.id}
        AND ${conversationMessage.role} = 'user'
    `);
    const countRows =
      (countResult as unknown as { count: number | string }[]) ?? [];
    const userMessageCount = Number(countRows[0]?.count ?? 0) || 0;

    const metadata = (row.metadata ?? {}) as ConversationMetadata;
    const { isHighIntent, reasons } = describeHighIntent({
      stage: metadata.stage ?? null,
      bookingInterest: metadata.bookingInterest ?? null,
      userMessageCount,
    });

    const report: ConversationIntentReport = {
      conversationId: row.id,
      organizationId: row.organizationId,
      platform: row.platform,
      externalUserId: row.externalUserId,
      externalUserName: row.externalUserName ?? null,
      attribution: {
        adMetaId: metadata.adMetaId ?? null,
        adInternalId: metadata.adInternalId ?? null,
        adTitle: metadata.adTitle ?? null,
        attributed: Boolean(metadata.adMetaId),
      },
      stage: metadata.stage ?? null,
      bookingInterest: metadata.bookingInterest === true,
      userMessageCount,
      isHighIntent,
      reasons,
    };

    return ok(report);
  } catch {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to inspect conversation intent'
      )
    );
  }
};

export const inspectConversationIntent = (
  db: DbConnection,
  input: InspectConversationIntentInput
) =>
  trackedResult(
    'metaCampaigns.inspectConversationIntent',
    () => inspectConversationIntentImpl(db, input),
    { internalErrorsOnly: true }
  );

export type InspectConversationIntentResult = Awaited<
  ReturnType<typeof inspectConversationIntent>
>;
