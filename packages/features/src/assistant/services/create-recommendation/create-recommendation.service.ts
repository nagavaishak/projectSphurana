import {
  type AssistantRecommendation,
  assistantRecommendation,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CreateRecommendationInput,
  createRecommendationSchema,
} from './create-recommendation.schema.js';

const createRecommendationImpl = async (
  db: DbConnection,
  input: CreateRecommendationInput
): Promise<Result<AssistantRecommendation>> => {
  const parsed = createRecommendationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    kind,
    title,
    body,
    primaryAction,
    priority,
    metadata,
    expiresAt,
  } = parsed.data;

  // NOTE (RLS W-SYS flag): createRecommendation is called from BOTH the request
  // path (API) AND cron triggers (_shared.ts via dedup+create). Callers must
  // scope appropriately: request-path → withOrgScope, cron → withSystemScope.
  try {
    const [row] = await db
      .insert(assistantRecommendation)
      .values({
        organizationId,
        kind,
        title,
        body,
        primaryAction,
        priority,
        metadata,
        expiresAt,
      })
      .returning();

    if (!row) {
      return err(
        new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Insert returned no row')
      );
    }

    return ok(row);
  } catch (error) {
    logError('assistant.createRecommendation', error, {
      feature: 'assistant',
      extra: { organizationId, kind },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create recommendation'
      )
    );
  }
};

export const createRecommendation = (
  db: DbConnection,
  input: CreateRecommendationInput
) =>
  trackedResult(
    'assistant.createRecommendation',
    () => createRecommendationImpl(db, input),
    {
      properties: { organizationId: input.organizationId, kind: input.kind },
    }
  );
