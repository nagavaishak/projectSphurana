import {
  type AssistantRecommendation,
  assistantRecommendation,
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
  type FindActiveRecommendationByKindInput,
  findActiveRecommendationByKindSchema,
} from './find-active-recommendation-by-kind.schema.js';

/**
 * Dedup helper used by every trigger before it calls createRecommendation.
 * If an active row already exists for the same org + kind, the trigger
 * should skip rather than queue a duplicate. See claire-build-plan.md.
 */
const findActiveRecommendationByKindImpl = async (
  db: DbConnection,
  input: FindActiveRecommendationByKindInput
): Promise<Result<AssistantRecommendation | null>> => {
  const parsed = findActiveRecommendationByKindSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, kind } = parsed.data;

  // NOTE (RLS W-SYS flag): findActiveRecommendationByKind is called from BOTH
  // the request path (API controller) AND cron triggers (_shared.ts). Callers
  // must scope appropriately: request-path → withOrgScope, cron → withSystemScope.
  try {
    const [row] = await db
      .select()
      .from(assistantRecommendation)
      .where(
        and(
          eq(assistantRecommendation.organizationId, organizationId),
          eq(assistantRecommendation.kind, kind),
          eq(assistantRecommendation.state, 'active')
        )
      )
      .limit(1);

    return ok(row ?? null);
  } catch (error) {
    logError('assistant.findActiveRecommendationByKind', error, {
      feature: 'assistant',
      extra: { organizationId, kind },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to look up recommendation'
      )
    );
  }
};

export const findActiveRecommendationByKind = (
  db: DbConnection,
  input: FindActiveRecommendationByKindInput
) =>
  trackedResult(
    'assistant.findActiveRecommendationByKind',
    () => findActiveRecommendationByKindImpl(db, input),
    {
      properties: { organizationId: input.organizationId, kind: input.kind },
      internalErrorsOnly: true,
    }
  );
