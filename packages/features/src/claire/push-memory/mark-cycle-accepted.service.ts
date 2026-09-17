import { assistantRecommendation } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../shared/index.js';
import { getCurrentCycle } from './get-current-cycle.service.js';
import {
  type ClaireCycleMetadata,
  claireCycleKindValues,
} from './push-memory.schema.js';

export const markCycleAcceptedSchema = z.object({
  organizationId: z.string().min(1),
  conversationId: z.string().min(1),
  kind: z.enum(claireCycleKindValues),
  acceptedAtRank: z.number().int().positive(),
});

export type MarkCycleAcceptedInput = z.infer<typeof markCycleAcceptedSchema>;

/**
 * Record the rank at which the operator accepted Claire's recommendation
 * on the push-memory cycle. Telemetry reads `acceptedAtRank` off the
 * cycle metadata when emitting the `published` / `draft_saved` events so
 * the full funnel survives a chat reload.
 *
 * Idempotent: no-op when no active cycle exists. Overwrites a prior
 * `acceptedAtRank` only if the new rank is closer to the top pick (rank
 * 1 wins over rank 2, etc.) — protects against a later service swap
 * inflating the recorded acceptance rank.
 */
const markCycleAcceptedImpl = async (
  db: DbConnection,
  input: MarkCycleAcceptedInput
): Promise<Result<{ updated: boolean }>> => {
  const parsed = markCycleAcceptedSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, conversationId, kind, acceptedAtRank } = parsed.data;

  const existing = await getCurrentCycle(db, {
    organizationId,
    conversationId,
    kind,
  });
  if (!existing.success) {
    return err(new FeatureError(existing.error.code, existing.error.message));
  }
  if (!existing.data) return ok({ updated: false });

  const current = (existing.data.metadata as ClaireCycleMetadata | null) ?? {
    surface: 'chat' as const,
    conversationId,
  };
  if (
    typeof current.acceptedAtRank === 'number' &&
    current.acceptedAtRank <= acceptedAtRank
  ) {
    return ok({ updated: false });
  }

  const nextMetadata: ClaireCycleMetadata = {
    ...current,
    surface: 'chat',
    conversationId,
    acceptedAtRank,
  };

  await db
    .update(assistantRecommendation)
    .set({ metadata: nextMetadata })
    .where(eq(assistantRecommendation.id, existing.data.id));

  return ok({ updated: true });
};

export const markCycleAccepted = (
  db: DbConnection,
  input: MarkCycleAcceptedInput
) =>
  trackedResult(
    'claire.pushMemory.markCycleAccepted',
    () => markCycleAcceptedImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        kind: input.kind,
        acceptedAtRank: input.acceptedAtRank,
      },
      internalErrorsOnly: true,
    }
  );

export type MarkCycleAcceptedResult = Awaited<
  ReturnType<typeof markCycleAccepted>
>;
