import {
  type AssistantRecommendation,
  assistantRecommendation,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../shared/index.js';
import {
  type GetCurrentCycleInput,
  getCurrentCycleSchema,
} from './push-memory.schema.js';

/**
 * Read the active push-memory row for this conversation + kind.
 *
 * The row's metadata carries `{ surface: 'chat', conversationId, ... }`.
 * We match on (organizationId, kind, state='active') and then filter the
 * conversationId in the JSON; in practice the (org, conversation, kind)
 * tuple is uniquely served by at most one active row at a time.
 */
const getCurrentCycleImpl = async (
  db: DbConnection,
  input: GetCurrentCycleInput
): Promise<Result<AssistantRecommendation | null>> => {
  const parsed = getCurrentCycleSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, conversationId, kind } = parsed.data;

  const rows = await db
    .select()
    .from(assistantRecommendation)
    .where(
      and(
        eq(assistantRecommendation.organizationId, organizationId),
        eq(assistantRecommendation.kind, kind),
        eq(assistantRecommendation.state, 'active'),
        sql`${assistantRecommendation.metadata}->>'conversationId' = ${conversationId}`
      )
    )
    .orderBy(desc(assistantRecommendation.createdAt))
    .limit(1);

  return ok(rows[0] ?? null);
};

export const getCurrentCycle = (
  db: DbConnection,
  input: GetCurrentCycleInput
) =>
  trackedResult(
    'claire.pushMemory.getCurrentCycle',
    () => getCurrentCycleImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        kind: input.kind,
      },
      internalErrorsOnly: true,
    }
  );

export type GetCurrentCycleResult = Awaited<ReturnType<typeof getCurrentCycle>>;
