import {
  assistantRecommendation,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
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
  type MarkRecommendationActionedInput,
  markRecommendationActionedSchema,
} from './mark-recommendation-actioned.schema.js';

const markRecommendationActionedImpl = async (
  db: DbConnection,
  input: MarkRecommendationActionedInput
): Promise<Result<{ id: string }>> => {
  const parsed = markRecommendationActionedSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { recommendationId, organizationId } = parsed.data;

  try {
    const [row] = await withOrgScope(
      (tx) =>
        tx
          .update(assistantRecommendation)
          .set({
            state: 'actioned',
            actionedAt: new Date(),
          })
          .where(
            and(
              eq(assistantRecommendation.id, recommendationId),
              eq(assistantRecommendation.organizationId, organizationId)
            )
          )
          .returning({ id: assistantRecommendation.id }),
      { db }
    );

    if (!row) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Recommendation not found')
      );
    }

    return ok(row);
  } catch (error) {
    logError('assistant.markRecommendationActioned', error, {
      feature: 'assistant',
      extra: { recommendationId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to mark recommendation actioned'
      )
    );
  }
};

export const markRecommendationActioned = (
  db: DbConnection,
  input: MarkRecommendationActionedInput
) =>
  trackedResult(
    'assistant.markRecommendationActioned',
    () => markRecommendationActionedImpl(db, input),
    {
      properties: {
        recommendationId: input.recommendationId,
        organizationId: input.organizationId,
      },
    }
  );
