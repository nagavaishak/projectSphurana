import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  describeHighIntent,
  getAttributedConversationSignals,
} from '../shared/index.js';
import {
  type CampaignConversationIntents,
  type ListCampaignConversationIntentsInput,
  listCampaignConversationIntentsSchema,
} from './list-campaign-conversation-intents.schema.js';

/**
 * Per-conversation high vs low intent breakdown for a campaign (PRD-1
 * follow-up — testability). Lets you SEE which attributed conversations count
 * as high-intent leads and exactly why, using the same shared predicate the
 * diagnosis and trigger use.
 */
const listCampaignConversationIntentsImpl = async (
  db: DbConnection,
  input: ListCampaignConversationIntentsInput
): Promise<Result<CampaignConversationIntents>> => {
  const parsed = listCampaignConversationIntentsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, metaCampaignId, withinDays } = parsed.data;

  try {
    const signals = await getAttributedConversationSignals(db, {
      organizationId,
      metaCampaignId,
      withinDays,
    });

    const conversations = signals.map((s) => {
      const { isHighIntent, reasons } = describeHighIntent(s);
      return {
        conversationId: s.conversationId,
        stage: s.stage,
        bookingInterest: s.bookingInterest,
        userMessageCount: s.userMessageCount,
        lastActivityAt: s.lastActivityAt
          ? s.lastActivityAt.toISOString()
          : null,
        isHighIntent,
        reasons,
      };
    });

    const highIntentCount = conversations.filter((c) => c.isHighIntent).length;

    return ok({
      metaCampaignId,
      total: conversations.length,
      highIntentCount,
      lowIntentCount: conversations.length - highIntentCount,
      conversations,
    });
  } catch {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to list campaign conversation intents'
      )
    );
  }
};

export const listCampaignConversationIntents = (
  db: DbConnection,
  input: ListCampaignConversationIntentsInput
) =>
  trackedResult(
    'metaCampaigns.listCampaignConversationIntents',
    () => listCampaignConversationIntentsImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        metaCampaignId: input.metaCampaignId,
      },
      internalErrorsOnly: true,
    }
  );

export type ListCampaignConversationIntentsResult = Awaited<
  ReturnType<typeof listCampaignConversationIntents>
>;
