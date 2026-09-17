import {
  type AssistantRecommendation,
  assistantRecommendation,
} from '@borradh-workspace/database';
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
import { claireCycleKindValues } from './push-memory.schema.js';

const endCycleSchema = z.object({
  organizationId: z.string().min(1),
  conversationId: z.string().min(1),
  kind: z.enum(claireCycleKindValues),
  // 'actioned' = user accepted (publish or save draft).
  // 'dismissed' = user rejected (explicit "no thanks", or aborted draft).
  resolution: z.enum(['actioned', 'dismissed']),
});

export type EndCycleInput = z.infer<typeof endCycleSchema>;

/**
 * Close the active push-memory cycle for this conversation. Called from
 * publish_*, save_*_draft, and explicit reject tools. Once a cycle is
 * closed, Claire is free to push the top pick again on the next intent
 * mention.
 *
 * Idempotent: no-op when there's no active cycle to close.
 */
const endCycleImpl = async (
  db: DbConnection,
  input: EndCycleInput
): Promise<Result<AssistantRecommendation | null>> => {
  const parsed = endCycleSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, conversationId, kind, resolution } = parsed.data;

  const existing = await getCurrentCycle(db, {
    organizationId,
    conversationId,
    kind,
  });
  if (!existing.success) {
    return err(new FeatureError(existing.error.code, existing.error.message));
  }
  if (!existing.data) return ok(null);

  const now = new Date();
  const [updated] = await db
    .update(assistantRecommendation)
    .set(
      resolution === 'actioned'
        ? { state: 'actioned', actionedAt: now }
        : { state: 'dismissed', dismissedAt: now }
    )
    .where(eq(assistantRecommendation.id, existing.data.id))
    .returning();
  if (!updated) {
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to end cycle')
    );
  }
  return ok(updated);
};

export const endCycle = (db: DbConnection, input: EndCycleInput) =>
  trackedResult('claire.pushMemory.endCycle', () => endCycleImpl(db, input), {
    properties: {
      organizationId: input.organizationId,
      kind: input.kind,
      resolution: input.resolution,
    },
  });

export type EndCycleResult = Awaited<ReturnType<typeof endCycle>>;
