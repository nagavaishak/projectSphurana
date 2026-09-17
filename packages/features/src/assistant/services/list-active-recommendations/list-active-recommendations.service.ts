import {
  type AssistantRecommendation,
  assistantRecommendation,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, asc, desc, eq, gt, isNull, or } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListActiveRecommendationsInput,
  listActiveRecommendationsSchema,
} from './list-active-recommendations.schema.js';

const listActiveRecommendationsImpl = async (
  db: DbConnection,
  input: ListActiveRecommendationsInput
): Promise<Result<AssistantRecommendation[]>> => {
  const parsed = listActiveRecommendationsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  try {
    const now = new Date();

    // Order: priority desc, then createdAt asc (FIFO within same priority).
    // Per Decision 5: toast queue surfaces one at a time; the widget picks
    // the first row from this list.
    const rows = await withOrgScope(
      (tx) =>
        tx
          .select()
          .from(assistantRecommendation)
          .where(
            and(
              eq(assistantRecommendation.organizationId, organizationId),
              eq(assistantRecommendation.state, 'active'),
              or(
                isNull(assistantRecommendation.expiresAt),
                gt(assistantRecommendation.expiresAt, now)
              )
            )
          )
          .orderBy(
            desc(assistantRecommendation.priority),
            asc(assistantRecommendation.createdAt)
          ),
      { db }
    );

    return ok(rows);
  } catch (error) {
    logError('assistant.listActiveRecommendations', error, {
      feature: 'assistant',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to list recommendations'
      )
    );
  }
};

export const listActiveRecommendations = (
  db: DbConnection,
  input: ListActiveRecommendationsInput
) =>
  trackedResult(
    'assistant.listActiveRecommendations',
    () => listActiveRecommendationsImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );
