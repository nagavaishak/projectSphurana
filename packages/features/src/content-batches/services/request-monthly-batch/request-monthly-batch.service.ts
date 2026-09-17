/**
 * `requestMonthlyBatch` — the manual "Create Batch" trigger's async front
 * door.
 *
 * The full `generateMonthlyBatch` runs an LLM plan + per-video dispatch that
 * can take 30–60s — too long for an HTTP request. This service instead:
 *
 *   1. Preflights active service ownership and renderable uploaded media.
 *      This happens before `replace` is allowed to clear an existing batch.
 *   2. Runs `prepareMonthlyBatch` synchronously (DB-only, fast).
 *   3. Enqueues the slow plan/seed phase on BullMQ with a deterministic batch
 *      job id and retry policy.
 *   4. Returns `queued: true` only after Redis accepts the job. The client polls
 *      `GET /content-batches/current` and watches the items render.
 */

import {
  type ContentBatch,
  contentBatch,
  organizationService,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import { canPlanGraphics } from '../../../monthly-content-plan/index.js';
import {
  listServiceIdsWithMedia,
  listServiceIdsWithVideoFootage,
} from '../../../organization-services/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GenerateMonthlyBatchInput,
  type GenerateMonthlyBatchParsed,
  generateMonthlyBatchSchema,
} from '../generate-monthly-batch/generate-monthly-batch.schema.js';
import { prepareMonthlyBatch } from '../generate-monthly-batch/generate-monthly-batch.service.js';
import { queueMonthlyBatch } from '../queue-monthly-batch/index.js';

export interface RequestMonthlyBatchResponse {
  /** The prepared batch row. For `replace`/fresh runs its status is
   *  `'planning'`; the background seed promotes it to `'generating'`. */
  batch: ContentBatch;
  /** True when an existing batch was returned untouched (idempotent no-op) —
   *  nothing was queued. */
  alreadyExisted: boolean;
  /** True when background generation was kicked off for this batch. The
   *  client should poll `/content-batches/current` to watch items render. */
  queued: boolean;
  /** Counts after media preflight. These may be lower than the requested 6+6
   * when the selected services cannot support one modality. */
  effectiveGraphicCount: number;
  effectiveVideoCount: number;
  jobId?: string;
}

const preflightMonthlyBatch = async (
  db: DbConnection,
  input: GenerateMonthlyBatchParsed
): Promise<
  Result<{
    serviceIds: string[];
    graphicCount: number;
    videoCount: number;
  }>
> => {
  const requestedServiceIds = input.serviceIds
    ? [...new Set(input.serviceIds)]
    : undefined;

  const activeServices = await withOrgScope(
    (tx) =>
      tx
        .select({ id: organizationService.id })
        .from(organizationService)
        .where(
          and(
            eq(organizationService.organizationId, input.organizationId),
            eq(organizationService.isActive, true),
            requestedServiceIds
              ? inArray(organizationService.id, requestedServiceIds)
              : undefined
          )
        ),
    { db }
  );

  if (
    requestedServiceIds &&
    activeServices.length !== requestedServiceIds.length
  ) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'One or more selected services are no longer active. Refresh and try again.'
      )
    );
  }
  if (activeServices.length === 0) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Add an active service before creating a content batch.'
      )
    );
  }

  const serviceIds = activeServices.map((service) => service.id);
  const [graphicMediaResult, videoMediaResult] = await Promise.all([
    listServiceIdsWithMedia(db, { organizationId: input.organizationId }),
    listServiceIdsWithVideoFootage(db, {
      organizationId: input.organizationId,
    }),
  ]);
  if (!graphicMediaResult.success) {
    return err(
      new FeatureError(
        graphicMediaResult.error.code,
        'Could not check uploaded images. Please try again.'
      )
    );
  }
  if (!videoMediaResult.success) {
    return err(
      new FeatureError(
        videoMediaResult.error.code,
        'Could not check uploaded videos. Please try again.'
      )
    );
  }

  const selected = new Set(serviceIds);
  const hasGraphicMedia = graphicMediaResult.data.some((id) =>
    selected.has(id)
  );
  const hasVideoMedia = videoMediaResult.data.some((id) => selected.has(id));
  // Graphics still require an uploaded image for a selected service. Videos can
  // fall back to the curated stock bank when stock footage is permitted, so a
  // no-uploaded-video (or no-media-at-all) org still gets a batch — this is
  // what unblocks the onboarding "use stock for now" choice instead of a
  // dead-end error.
  // Graphics fall back exactly like videos do.
  //
  // This used to be `hasGraphicMedia ? input.graphicCount : 0` — a graphic
  // required an UPLOADED image on a selected service. That predates the slot
  // ladder in resolve-slot-image, which is now
  //
  //   service-video-thumbnail -> service-image-asset -> stock-image -> ai-generated
  //
  // so a graphic can be produced with no upload at all. The owner's consent to
  // fall back is `allowStockFootage`, which is the same signal the video line
  // below already uses; honouring it for one modality and not the other was an
  // oversight, not a policy.
  const graphicCount = canPlanGraphics({
    hasUploadedImage: hasGraphicMedia,
    allowStockFootage: input.allowStockFootage,
  })
    ? input.graphicCount
    : 0;
  const videoCount =
    hasVideoMedia || input.allowStockFootage ? input.videoCount : 0;

  if (graphicCount === 0 && videoCount === 0) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        input.allowStockFootage
          ? 'Add an active service to generate a batch.'
          : 'The selected services have no render-ready uploaded media. Upload something, or allow stock footage, and try again.'
      )
    );
  }

  return ok({ serviceIds, graphicCount, videoCount });
};

const requestMonthlyBatchImpl = async (
  db: DbConnection,
  input: GenerateMonthlyBatchInput
): Promise<Result<RequestMonthlyBatchResponse>> => {
  const parsedInput = generateMonthlyBatchSchema.safeParse(input);
  if (!parsedInput.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsedInput.error.issues,
      })
    );
  }

  // Preflight MUST precede prepare: prepare({ replace:true }) deletes the
  // current review queue, and an invalid selection must never destroy it.
  const preflight = await preflightMonthlyBatch(db, parsedInput.data);
  if (!preflight.success) return err(preflight.error);

  const effectiveInput: GenerateMonthlyBatchParsed = {
    ...parsedInput.data,
    ...preflight.data,
  };
  const prepResult = await prepareMonthlyBatch(db, effectiveInput);
  if (!prepResult.success) return err(prepResult.error);

  const prepared = prepResult.data;

  // Idempotent no-op: existing batch, no append/replace. Return it as-is.
  if (!prepared.shouldSeed) {
    return ok({
      batch: prepared.batch,
      alreadyExisted: true,
      queued: false,
      effectiveGraphicCount: prepared.graphicCount,
      effectiveVideoCount: prepared.videoCount,
    });
  }

  const enqueuePayload = {
    batchId: prepared.batchId,
    organizationId: prepared.organizationId,
    periodMonth: prepared.periodMonth,
    createdById: prepared.createdById,
    graphicCount: prepared.graphicCount,
    videoCount: prepared.videoCount,
    serviceIds: prepared.serviceIds,
    allowStockFootage: effectiveInput.allowStockFootage,
    videoPositionOffset: prepared.videoPositionOffset,
    graphicPositionOffset: prepared.graphicPositionOffset,
    markFailedOnError: prepared.markFailedOnError,
  };
  // prepare() for a replace run has already wiped the prior review queue, so a
  // transient Redis blip on enqueue would strand the org with neither the old
  // content nor a running job. Redis hiccups are brief — retry a couple of
  // times with a short backoff before treating the enqueue as terminal.
  let enqueueResult = await queueMonthlyBatch(enqueuePayload);
  for (let attempt = 1; attempt < 3 && !enqueueResult.success; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    enqueueResult = await queueMonthlyBatch(enqueuePayload);
  }
  if (!enqueueResult.success) {
    // The row is already prepared. Make the failure terminal and visible so
    // the client neither reports a false queue success nor polls forever.
    await withOrgScope(
      (tx) =>
        tx
          .update(contentBatch)
          .set({
            status: 'failed',
            errorMessage: enqueueResult.error.message,
            updatedAt: new Date(),
          })
          .where(eq(contentBatch.id, prepared.batchId)),
      { db }
    );
    return err(
      new FeatureError(
        enqueueResult.error.code,
        enqueueResult.error.message,
        enqueueResult.error.details
      )
    );
  }

  return ok({
    batch: prepared.batch,
    alreadyExisted: false,
    queued: true,
    effectiveGraphicCount: prepared.graphicCount,
    effectiveVideoCount: prepared.videoCount,
    jobId: enqueueResult.data.jobId,
  });
};

export const requestMonthlyBatch = (
  db: DbConnection,
  input: GenerateMonthlyBatchInput
) =>
  trackedResult(
    'contentBatches.requestMonthlyBatch',
    () => requestMonthlyBatchImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        periodMonth: input.periodMonth,
      },
    }
  );

export type RequestMonthlyBatchResult = Awaited<
  ReturnType<typeof requestMonthlyBatch>
>;
