import { randomUUID } from 'node:crypto';
import { organizationService } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { planVideoDetail } from '../../../videos/services/plan-video-detail/index.js';
import { getPlannableOrganicTemplates } from '../../../videos/templates/index.js';
import {
  type DispatchMonthlyPlanInput,
  dispatchMonthlyPlanSchema,
} from './dispatch-monthly-plan.schema.js';

export interface DispatchedItemFailure {
  /** Position in the plan.items array */
  index: number;
  kind: 'video' | 'carousel' | 'single';
  targetServiceId: string;
  error: string;
}

/**
 * One image item, ready for the nano-banana (Gemini) render. The worker
 * generates each graphic from the org's real service media + brand corpus,
 * keyed by `targetServiceId` + `topicSummary`. There is no template or
 * slot-fill planning step — the unified topic planner already chose the
 * service + topic per slot.
 */
export interface DispatchedImageRequest {
  graphicId: string;
  kind: 'carousel' | 'single';
  targetServiceId: string;
  serviceName: string;
  topicSummary: string;
}

export interface DispatchMonthlyPlanResponse {
  /** video.id of every successfully queued video render */
  videoIds: string[];
  /** graphic.id pre-allocated for every image item that resolved. The
   *  materialise step inserts the graphic row + content_batch_item later. */
  graphicIds: string[];
  /** Per-image-item requests for the nano-banana render. The materialise
   *  step turns each into a graphic row + a render-only job. */
  imageRequests: DispatchedImageRequest[];
  /** Per-item failures, isolated so one bad item doesn't kill the rest. */
  failures: DispatchedItemFailure[];
}

/**
 * Fan a `MonthlyContentPlan` out across the modality-specific dispatchers.
 *
 *   - Video items → `planVideoDetail` (queues a video render + inserts a
 *     content_batch_item).
 *   - Carousel / single items → emitted directly as nano-banana image
 *     requests (graphicId + service + topic). The worker renders them from
 *     the org's real service media + brand corpus; content_batch_item
 *     insertion is deferred to the materialise step.
 *
 * Per-item failures are isolated — one slot's failure should not take down
 * the rest of the month's plan. The aggregate result surfaces every failure
 * so the caller can decide whether to fail the whole batch (the
 * `runMonthlyBatchesCron` policy is "warn but keep going").
 */
const dispatchMonthlyPlanImpl = async (
  db: DbConnection,
  input: DispatchMonthlyPlanInput
): Promise<Result<DispatchMonthlyPlanResponse>> => {
  const parsed = dispatchMonthlyPlanSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    plan,
    batchId,
    createdById,
    videoSchedules,
    targetPageIds,
    cdnUrl,
    videoPositionOffset,
    graphicPositionOffset,
    allowStockFootage,
  } = parsed.data;

  // Verify videoSchedules cardinality matches the plan's video count.
  const videoItemCount = plan.items.filter((i) => i.kind === 'video').length;
  if (videoSchedules.length !== videoItemCount) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        `videoSchedules length (${videoSchedules.length}) does not match plan video count (${videoItemCount})`
      )
    );
  }

  const videoIds: string[] = [];
  const graphicIds: string[] = [];
  const imageRequests: DispatchedImageRequest[] = [];
  const failures: DispatchedItemFailure[] = [];

  // Resolve service names for the image items up front (one query). Used for
  // caption generation downstream and to skip slots whose service vanished.
  const imageServiceIds = Array.from(
    new Set(
      plan.items.filter((i) => i.kind !== 'video').map((i) => i.targetServiceId)
    )
  );
  const services = imageServiceIds.length
    ? await db.query.organizationService.findMany({
        where: inArray(organizationService.id, imageServiceIds),
        columns: { id: true, name: true },
      })
    : [];
  const serviceNameById = new Map(services.map((s) => [s.id, s.name]));

  // Round-robin organic videos across the registered organic templates so a
  // batch ships one of each (caption-tease, ins-outs, question-cta, improves,
  // then repeat) instead of all collapsing to the first template. The monthly
  // planner only picks service + topic per slot; it doesn't choose a template,
  // and `planVideoDetail` defaults to `organicTemplates[0]` when unpinned — so
  // without this pin every video came out `caption-tease-1`.
  const organicTemplates = getPlannableOrganicTemplates();

  let videoSlotIndex = 0;
  let videoPosition = videoPositionOffset;
  let graphicPosition = graphicPositionOffset;

  // We dispatch items in plan order. Video items run sequentially because
  // `planVideoDetail` already runs its two AI calls in parallel internally
  // and we don't want to fan out N concurrent OpenAI calls per org.
  for (let idx = 0; idx < plan.items.length; idx += 1) {
    const item = plan.items[idx];

    if (item.kind === 'video') {
      const scheduledAt = videoSchedules[videoSlotIndex];
      // Pin the template by slot so the batch cycles through all organic
      // variations. Each organic template has a single variation, so pinning
      // the template (and its first variation) fully determines the look.
      const tpl =
        organicTemplates.length > 0
          ? organicTemplates[videoSlotIndex % organicTemplates.length]
          : undefined;
      videoSlotIndex += 1;

      const result = await planVideoDetail(db, {
        organizationId: plan.organizationId,
        createdById,
        batchId,
        periodMonth: plan.periodMonth,
        targetServiceId: item.targetServiceId,
        topicSummary: item.topicSummary,
        position: videoPosition,
        scheduledAt,
        targetPageIds,
        cdnUrl,
        allowStockFootage,
        ...(tpl
          ? { templateId: tpl.id, variationId: tpl.variations[0]?.id }
          : {}),
      });

      if (result.success) {
        videoIds.push(result.data.videoId);
        videoPosition += 1;
      } else {
        const errMsg = `${result.error.code}: ${result.error.message}`;
        logError(
          'monthlyContentPlan.dispatchMonthlyPlan.video',
          new Error(errMsg),
          {
            feature: 'monthly-content-plan',
            extra: {
              batchId,
              index: idx,
              organizationId: plan.organizationId,
              targetServiceId: item.targetServiceId,
            },
          }
        );
        failures.push({
          index: idx,
          kind: 'video',
          targetServiceId: item.targetServiceId,
          error: errMsg,
        });
        // Don't advance videoPosition — keep slot numbering tight for
        // the items that DID land.
      }
      continue;
    }

    // carousel | single — nano-banana renders these from the org's real
    // service media + brand corpus. No template / slot-fill step: emit the
    // request directly from the plan item.
    const serviceName = serviceNameById.get(item.targetServiceId);
    if (!serviceName) {
      const errMsg = `${ErrorCodes.NOT_FOUND}: target service not found: ${item.targetServiceId}`;
      logError(
        'monthlyContentPlan.dispatchMonthlyPlan.image',
        new Error(errMsg),
        {
          feature: 'monthly-content-plan',
          extra: {
            batchId,
            index: idx,
            organizationId: plan.organizationId,
            kind: item.kind,
            targetServiceId: item.targetServiceId,
          },
        }
      );
      failures.push({
        index: idx,
        kind: item.kind,
        targetServiceId: item.targetServiceId,
        error: errMsg,
      });
      continue;
    }

    const graphicId = randomUUID();
    graphicIds.push(graphicId);
    imageRequests.push({
      graphicId,
      kind: item.kind,
      targetServiceId: item.targetServiceId,
      serviceName,
      topicSummary: item.topicSummary,
    });
    graphicPosition += 1;
  }

  // Suppress unused-var warning — the counter mirrors videoPosition and is
  // kept for symmetry / future use if materialise moves into this dispatcher.
  void graphicPosition;

  return ok({
    videoIds,
    graphicIds,
    imageRequests,
    failures,
  });
};

/**
 * Dispatch a `MonthlyContentPlan` to its modality-specific dispatchers. See
 * implementation for the per-modality fan-out.
 *
 * The dispatcher does NOT insert `content_batch_item` rows for image items —
 * that happens in the materialise step. The video path is end-to-end (it
 * inserts the batch item + queues the render synchronously) because the video
 * render pipeline is already fire-and-forget BullMQ.
 */
export const dispatchMonthlyPlan = (
  db: DbConnection,
  input: DispatchMonthlyPlanInput
) =>
  trackedResult(
    'monthlyContentPlan.dispatchMonthlyPlan',
    () => dispatchMonthlyPlanImpl(db, input),
    {
      properties: {
        organizationId: input.plan.organizationId,
        periodMonth: input.plan.periodMonth,
        batchId: input.batchId,
        itemCount: input.plan.items.length,
      },
    }
  );

export type DispatchMonthlyPlanResult = Awaited<
  ReturnType<typeof dispatchMonthlyPlan>
>;
