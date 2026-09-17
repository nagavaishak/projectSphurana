import {
  type AssistantRecommendation,
  assistantRecommendation,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
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
  type SetDraftPointerInput,
  setDraftPointerSchema,
} from './push-memory.schema.js';

/**
 * Attach a draftId to the active push-memory cycle for this conversation +
 * kind, opening a fresh cycle if none exists. Called by the draft-state
 * services when a draft is first created so future `getOrCreateDraft*`
 * calls can find it via the cycle row.
 */
const setDraftPointerImpl = async (
  db: DbConnection,
  input: SetDraftPointerInput
): Promise<Result<AssistantRecommendation>> => {
  const parsed = setDraftPointerSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, conversationId, kind, draftId } = parsed.data;

  const existing = await getCurrentCycle(db, {
    organizationId,
    conversationId,
    kind,
  });
  if (!existing.success) {
    return err(new FeatureError(existing.error.code, existing.error.message));
  }

  if (!existing.data) {
    // No active cycle yet — open one. This path fires when the user starts
    // with a set_pending_* tool (skipping the recommend_* probe). The
    // rankedServiceId for the cycle is the same as the draft's first
    // service; we record the draftId straight away.
    const title =
      kind === 'ad_flow_service_pick'
        ? 'Service pick — chat'
        : 'Offer pick — chat';
    const body =
      kind === 'ad_flow_service_pick'
        ? 'Claire pushed the top-ranked service for this conversation.'
        : 'Claire pushed the top-ranked offer for this conversation.';

    const metadata: ClaireCycleMetadata = {
      surface: 'chat',
      conversationId,
      // The user picked their own service; the cycle has no rankedServiceId.
      draftId,
      impressionAt: new Date().toISOString(),
    };

    const [row] = await db
      .insert(assistantRecommendation)
      .values({
        organizationId,
        kind,
        title,
        body,
        primaryAction: { label: 'Open chat', type: 'none' },
        priority: 0,
        metadata,
      })
      .returning();
    if (!row) {
      return err(
        new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to open cycle')
      );
    }
    return ok(row);
  }

  const nextMetadata = {
    ...(existing.data.metadata ?? {}),
    draftId,
  };

  const [updated] = await db
    .update(assistantRecommendation)
    .set({ metadata: nextMetadata })
    .where(eq(assistantRecommendation.id, existing.data.id))
    .returning();
  if (!updated) {
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to update cycle')
    );
  }
  return ok(updated);
};

export const setDraftPointer = (
  db: DbConnection,
  input: SetDraftPointerInput
) =>
  trackedResult(
    'claire.pushMemory.setDraftPointer',
    () => setDraftPointerImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        kind: input.kind,
        draftId: input.draftId,
      },
    }
  );

export type SetDraftPointerResult = Awaited<ReturnType<typeof setDraftPointer>>;
