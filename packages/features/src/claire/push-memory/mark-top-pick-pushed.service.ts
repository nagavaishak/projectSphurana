import {
  type AssistantRecommendation,
  assistantRecommendation,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
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
  type MarkTopPickPushedInput,
  markTopPickPushedSchema,
} from './push-memory.schema.js';

/**
 * Open a push-memory cycle for this conversation + kind.
 *
 * If an active row already exists for this (org, conversation, kind), this
 * returns the existing row (idempotent). Otherwise it inserts a fresh
 * `assistantRecommendation` with:
 *   - kind: `ad_flow_service_pick` | `ad_flow_offer_pick`
 *   - state: 'active'
 *   - metadata: { surface: 'chat', conversationId, rankedServiceId, draftId? }
 *
 * Title/body are tiny ('Service pick — chat' etc.) — the widget never
 * surfaces these rows (they're scoped to the chat surface). They exist so
 * the dismiss/actioned lifecycle is captured for telemetry (Window 8).
 */
const markTopPickPushedImpl = async (
  db: DbConnection,
  input: MarkTopPickPushedInput
): Promise<Result<AssistantRecommendation>> => {
  const parsed = markTopPickPushedSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, conversationId, kind, rankedServiceId, draftId } =
    parsed.data;

  // Idempotent: if a cycle already exists, return it instead of
  // duplicating. Callers that need to refresh `draftId` should use
  // setDraftPointer below.
  const existing = await getCurrentCycle(db, {
    organizationId,
    conversationId,
    kind,
  });
  if (!existing.success) {
    return err(new FeatureError(existing.error.code, existing.error.message));
  }
  if (existing.data) {
    return ok(existing.data);
  }

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
    rankedServiceId,
    impressionAt: new Date().toISOString(),
    ...(draftId ? { draftId } : {}),
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
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to open push-memory cycle'
      )
    );
  }
  return ok(row);
};

export const markTopPickPushed = (
  db: DbConnection,
  input: MarkTopPickPushedInput
) =>
  trackedResult(
    'claire.pushMemory.markTopPickPushed',
    () => markTopPickPushedImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        kind: input.kind,
        rankedServiceId: input.rankedServiceId,
      },
    }
  );

export type MarkTopPickPushedResult = Awaited<
  ReturnType<typeof markTopPickPushed>
>;
