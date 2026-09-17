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
  type DismissRecommendationInput,
  dismissRecommendationSchema,
} from './dismiss-recommendation.schema.js';

const dismissRecommendationImpl = async (
  db: DbConnection,
  input: DismissRecommendationInput
): Promise<Result<{ id: string }>> => {
  const parsed = dismissRecommendationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { recommendationId, organizationId } = parsed.data;

  try {
    // Scope by orgId so one org can't dismiss another org's recommendations.
    const [row] = await withOrgScope(
      (tx) =>
        tx
          .update(assistantRecommendation)
          .set({
            state: 'dismissed',
            dismissedAt: new Date(),
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
    logError('assistant.dismissRecommendation', error, {
      feature: 'assistant',
      extra: { recommendationId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to dismiss recommendation'
      )
    );
  }
};

export const dismissRecommendation = (
  db: DbConnection,
  input: DismissRecommendationInput
) =>
  trackedResult(
    'assistant.dismissRecommendation',
    () => dismissRecommendationImpl(db, input),
    {
      properties: {
        recommendationId: input.recommendationId,
        organizationId: input.organizationId,
      },
    }
  );
