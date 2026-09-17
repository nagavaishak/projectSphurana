import {
  RATE_LIMIT_MESSAGE,
  extractJson,
  initAIClient,
  isAIClientInitialized,
  isRateLimitError,
} from '@borradh-workspace/ai';
import { organizationService } from '@borradh-workspace/database';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import type {
  MonthlyContentPlan,
  PlannedContentItem,
} from '../../../image-generation/types.js';
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
import { getOrgContext } from '../../../shared/org-context.js';
import { canPlanGraphics } from '../../graphics-eligibility.js';
import {
  type ClaudeMonthlyPlan,
  type PlanMonthlyContentInput,
  claudeMonthlyPlanSchema,
  planMonthlyContentSchema,
} from './plan-monthly-content.schema.js';
import {
  type PromptServiceCandidate,
  buildMonthlyPlanPrompt,
} from './prompts.js';

const logger = createLogger('MonthlyContentPlanner');

const ensureAIClient = async (): Promise<Result<void>> => {
  if (isAIClientInitialized()) return ok(undefined);
  const { apiEnv } = await import('@borradh-workspace/env/api');
  const apiKey = apiEnv.OPENAI_API_KEY;
  if (!apiKey) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'OpenAI API key not configured'
      )
    );
  }
  initAIClient({ apiKey });
  return ok(undefined);
};

/**
 * Recent-topic dedup is a no-op on the post-Canva schema.
 *
 * Historically we read `content_batch_item.topicSummary` (set by the unified
 * planner) to feed Claude a list of recently-used topics to vary against.
 * Migration 0038 dropped that column — the in-memory planner type
 * `MonthlyContentPlanItem.topicSummary` still carries the per-item summary
 * for the current call, but nothing persists it across batches. Until a
 * replacement signal lands, the function returns an empty list so the
 * planner keeps running.
 */
const fetchRecentTopics = async (
  _db: DbConnection,
  _organizationId: string,
  _lookbackDays: number
): Promise<string[]> => {
  return [];
};

/**
 * Pull active services for the org. These ARE the "services we recommend
 * advertising" — the workspace doesn't currently have a dedicated
 * recommended-services system; the active service catalog (filtered by
 * `isActive=true`) is what surfaces in the services-dashboard UI as the
 * set the user has chosen to promote.
 *
 * IMPORTANT: this returns ALL active services. The `hasMedia` flag (derived
 * from `mediaServiceIds`) marks which services are eligible for GRAPHICS, and
 * `hasVideoFootage` (derived from `videoFootageServiceIds`) marks which are
 * eligible for VIDEOS. We never narrow the candidate list itself — the
 * planner picks an eligible service per modality.
 *
 * NOTE for future iteration: if a `shouldAdvertise` / priority signal is
 * added to `organization_service`, filter on it here.
 */
const fetchCandidateServices = async (
  db: DbConnection,
  organizationId: string,
  mediaServiceIds: Set<string>,
  videoFootageServiceIds: Set<string>
): Promise<PromptServiceCandidate[]> => {
  const rows = await db
    .select({
      id: organizationService.id,
      name: organizationService.name,
      painPoints: organizationService.painPoints,
      expectedResults: organizationService.expectedResults,
      processDescription: organizationService.processDescription,
      targetArea: organizationService.targetArea,
    })
    .from(organizationService)
    .where(
      and(
        eq(organizationService.organizationId, organizationId),
        eq(organizationService.isActive, true)
      )
    );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    painPoints: r.painPoints as string[] | null,
    expectedResults: r.expectedResults as string[] | null,
    processDescription: r.processDescription,
    targetArea: r.targetArea,
    hasMedia: mediaServiceIds.has(r.id),
    hasVideoFootage: videoFootageServiceIds.has(r.id),
  }));
};

/** An item the validator removed from the plan, with why. */
export interface DroppedPlanItem {
  kind: PlannedContentItem['kind'];
  targetServiceId: string;
  reason: string;
}

/**
 * Validate Claude's structured plan and DEGRADE GRACEFULLY rather than reject.
 *
 * The planner offers the model the full active-service catalog tagged with
 * per-modality eligibility (`hasMedia` for graphics, `hasVideoFootage` for
 * video). When only a handful of services have footage among many that don't,
 * the model occasionally assigns a video (or graphic) to an ineligible
 * service. Hard-failing the whole plan on the first such item turns one bad
 * pick into a fully failed batch — zero content for the customer for the month.
 *
 * Instead we DROP the items we can't honour and keep the rest:
 *   - targetServiceId not in the candidate set              → drop
 *   - graphic item whose service has no uploaded media      → drop
 *   - topicSummary duplicates a recent or already-kept topic → drop
 *   - items beyond the requested per-kind count              → drop (overproduced)
 *
 * Video items are NOT dropped for lacking uploaded footage. `planVideoDetail`
 * falls back to the curated stock bank, AI-matched to the service, in that
 * case when stock footage is allowed.
 *
 * The caller proceeds with the surviving items (and fails only if NONE
 * survive). Drops are returned so the caller can log what was degraded.
 */
export const validatePlan = (
  plan: ClaudeMonthlyPlan,
  candidateServiceIds: Set<string>,
  mediaServiceIds: Set<string>,
  videoFootageServiceIds: Set<string>,
  recentTopics: string[],
  videoCount: number,
  carouselCount: number,
  singleCount: number,
  allowStockFootage = true
): { items: PlannedContentItem[]; dropped: DroppedPlanItem[] } => {
  const dropped: DroppedPlanItem[] = [];
  const kept: PlannedContentItem[] = [];

  // The model is asked for exact counts but may over-produce; keep at most the
  // requested number of each kind.
  const caps: Record<PlannedContentItem['kind'], number> = {
    video: videoCount,
    carousel: carouselCount,
    single: singleCount,
  };
  const keptByKind = { video: 0, carousel: 0, single: 0 } as Record<
    PlannedContentItem['kind'],
    number
  >;

  // Dedup against recent topics AND within the plan itself (case-insensitive).
  const seenTopics = new Set(recentTopics.map((t) => t.trim().toLowerCase()));

  for (const item of plan.items) {
    const drop = (reason: string) =>
      dropped.push({
        kind: item.kind,
        targetServiceId: item.targetServiceId,
        reason,
      });

    if (!candidateServiceIds.has(item.targetServiceId)) {
      drop('service not in candidate set');
      continue;
    }
    // Graphics need a visual source for their target service — which, with the
    // stock fallback on, ANY candidate service has.
    //
    // THE THIRD COPY of the eligibility rule, and the one that kept winning.
    // `canPlanGraphics` was introduced to settle it in one place and the two
    // COUNT gates were updated; this per-ITEM gate was missed, and it is the
    // last one in the pipeline — so the count said "plan 6 graphics", the model
    // produced 6, and every one was dropped here. The batch came out all
    // videos, with only a `dropped` log to say why.
    //
    // Mirrors the video branch immediately below, deliberately: `resolve-slot-image`
    // ends in stock-image -> ai-generated, so an org with no uploaded photo can
    // still produce a graphic, and `allowStockFootage` is the owner's consent
    // to exactly that.
    if (
      item.kind !== 'video' &&
      !allowStockFootage &&
      !mediaServiceIds.has(item.targetServiceId)
    ) {
      drop('graphic targets service with no uploaded media');
      continue;
    }
    // Videos require uploaded footage unless the caller opted into stock
    // fallback for no-footage services.
    if (
      item.kind === 'video' &&
      !allowStockFootage &&
      !videoFootageServiceIds.has(item.targetServiceId)
    ) {
      drop('video targets service with no uploaded footage');
      continue;
    }
    const topicKey = item.topicSummary.trim().toLowerCase();
    if (seenTopics.has(topicKey)) {
      drop('duplicate topic');
      continue;
    }
    if (keptByKind[item.kind] >= caps[item.kind]) {
      drop(`exceeds requested ${item.kind} count`);
      continue;
    }

    seenTopics.add(topicKey);
    keptByKind[item.kind] += 1;
    kept.push(item);
  }

  return { items: kept, dropped };
};

const planMonthlyContentImpl = async (
  db: DbConnection,
  input: PlanMonthlyContentInput
): Promise<Result<MonthlyContentPlan>> => {
  const parsed = planMonthlyContentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    periodMonth,
    videoCount,
    carouselCount,
    singleCount,
    serviceIds,
    allowStockFootage,
    recentTopicsLookbackDays,
  } = parsed.data;

  // ── 1. Load org context (brand voice, business type, audience) ────────
  const orgContext = await getOrgContext(db, organizationId);
  if (!orgContext) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  // ── 2. Load candidate services + per-modality media eligibility ───────
  // Graphics are built from a service's uploaded photos/clips (never AI), and
  // a video uses only the target service's OWN footage (never another
  // service's), so each modality gates on its own media set:
  //   - mediaServiceIds         → services eligible for GRAPHICS
  //   - videoFootageServiceIds  → services eligible for VIDEOS
  // The candidate list itself is never narrowed; the planner picks an
  // eligible service per item.
  const [mediaResult, videoFootageResult] = await Promise.all([
    listServiceIdsWithMedia(db, { organizationId }),
    listServiceIdsWithVideoFootage(db, { organizationId }),
  ]);
  const mediaServiceIds = new Set(mediaResult.success ? mediaResult.data : []);
  const videoFootageServiceIds = new Set(
    videoFootageResult.success ? videoFootageResult.data : []
  );

  const allCandidates = await fetchCandidateServices(
    db,
    organizationId,
    mediaServiceIds,
    videoFootageServiceIds
  );

  // Hard filter: when the caller passes `serviceIds`, restrict candidates to
  // that set (intersected with active services). Omitted → all active.
  const serviceCandidates =
    serviceIds && serviceIds.length > 0
      ? allCandidates.filter((s) => serviceIds.includes(s.id))
      : allCandidates;
  if (serviceCandidates.length === 0) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        serviceIds && serviceIds.length > 0
          ? 'None of the selected services are active — cannot plan content'
          : 'Organisation has no active services — cannot plan content'
      )
    );
  }
  const candidateServiceIds = new Set(serviceCandidates.map((s) => s.id));

  // Narrow the per-modality eligibility sets to the candidate services so the
  // count clamps + validation below reflect the (possibly filtered) selection.
  for (const id of [...mediaServiceIds]) {
    if (!candidateServiceIds.has(id)) mediaServiceIds.delete(id);
  }
  for (const id of [...videoFootageServiceIds]) {
    if (!candidateServiceIds.has(id)) videoFootageServiceIds.delete(id);
  }

  // Graphics fall back exactly like videos do — see the video clamp below,
  // which treats ANY candidate service as eligible when stock is allowed.
  //
  // This clamped graphic counts to 0 whenever no selected service had an
  // uploaded image, on the reasoning that a graphic could not "legitimately be
  // backed with media". The slot ladder in resolve-slot-image ends in
  // `stock-image` and then `ai-generated`, so it can be.
  //
  // It was also the SECOND gate saying the same thing — request-monthly-batch
  // has one — so fixing either alone changed nothing, and it failed SILENTLY:
  // a `logger.info`, no error, the batch left in `generating`, and a request
  // for six graphics returning zero with nothing on the row to explain it.
  const hasAnyMedia = mediaServiceIds.size > 0;
  const graphicsAllowed = canPlanGraphics({
    hasUploadedImage: hasAnyMedia,
    allowStockFootage,
  });
  const effectiveCarouselCount = graphicsAllowed ? carouselCount : 0;
  const effectiveSingleCount = graphicsAllowed ? singleCount : 0;
  if (!hasAnyMedia && carouselCount + singleCount > 0) {
    logger.info(
      graphicsAllowed
        ? 'No services with uploaded media — graphics will use stock or AI imagery'
        : 'No services with uploaded media and stock not allowed — skipping graphics',
      {
        organizationId,
        periodMonth,
        carouselCount,
        singleCount,
        allowStockFootage,
      }
    );
  }

  // A video needs a visual source for its target service. With stock fallback
  // on, ANY candidate service is video-eligible (the curated stock tier backs
  // the footage-less ones); with it off, only services with uploaded footage
  // are. Videos are plannable when at least one such service exists, and zero
  // when none do (mirrors the graphics gate above).
  //
  // Do NOT clamp the count to the number of eligible services: the prompt
  // explicitly allows reusing a service across items when the topics are
  // distinct (rule 3), and a per-service clamp silently under-fills the batch
  // — an org with 2 footage-backed services got 8 of 12 requested pieces.
  // Ineligible picks are still dropped by `validatePlan` (which is itself
  // stock-aware), which is what the original clamp was protecting against.
  const videoEligibleServiceCount = allowStockFootage
    ? candidateServiceIds.size
    : videoFootageServiceIds.size;
  const hasAnyVideoSource = videoEligibleServiceCount > 0;
  const effectiveVideoCount = hasAnyVideoSource ? videoCount : 0;
  if (!hasAnyVideoSource && videoCount > 0) {
    logger.info('No services with a usable video source — skipping videos', {
      organizationId,
      periodMonth,
      requestedVideo: videoCount,
      allowStockFootage,
    });
  }

  // ── 3. Load recent topics for dedup ───────────────────────────────────
  const recentTopics = await fetchRecentTopics(
    db,
    organizationId,
    recentTopicsLookbackDays
  );

  // ── 4. Initialise AI client ───────────────────────────────────────────
  const aiInit = await ensureAIClient();
  if (!aiInit.success) return err(aiInit.error);

  // ── 5. Build prompt + call Claude (via shared chatCompletion) ─────────
  const { systemMessage, userMessage } = buildMonthlyPlanPrompt({
    orgContext,
    serviceCandidates,
    recentTopics,
    periodMonth,
    videoCount: effectiveVideoCount,
    carouselCount: effectiveCarouselCount,
    singleCount: effectiveSingleCount,
    allowStockFootage,
  });

  logger.info('Generating monthly content plan', {
    organizationId,
    periodMonth,
    candidateServiceCount: serviceCandidates.length,
    mediaServiceCount: mediaServiceIds.size,
    videoFootageServiceCount: videoFootageServiceIds.size,
    recentTopicCount: recentTopics.length,
    targetItemCount:
      effectiveVideoCount + effectiveCarouselCount + effectiveSingleCount,
  });

  try {
    const result = await extractJson(userMessage, {
      systemMessage,
      schema: claudeMonthlyPlanSchema,
      // Slightly lower temperature than per-slot copy generation — we
      // want a varied but well-structured month, not a wild brainstorm.
      temperature: 0.5,
    });

    if (!result.success || !result.data) {
      if (result.error === RATE_LIMIT_MESSAGE) {
        return err(
          new FeatureError(ErrorCodes.RATE_LIMITED, RATE_LIMIT_MESSAGE)
        );
      }
      logError(
        'monthlyContentPlan.planMonthlyContent',
        new Error('AI extraction failed'),
        {
          feature: 'monthly-content-plan',
          extra: {
            organizationId,
            periodMonth,
            raw: result.raw,
            error: result.error,
          },
        }
      );
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to generate monthly content plan'
        )
      );
    }

    const validation = validatePlan(
      result.data,
      candidateServiceIds,
      mediaServiceIds,
      videoFootageServiceIds,
      recentTopics,
      effectiveVideoCount,
      effectiveCarouselCount,
      effectiveSingleCount,
      allowStockFootage
    );

    if (validation.dropped.length > 0) {
      logger.warn('Dropped unbacked monthly plan items', {
        organizationId,
        periodMonth,
        droppedCount: validation.dropped.length,
        keptCount: validation.items.length,
        drops: validation.dropped,
      });
    }

    // The model can simply return FEWER items than asked for, and that path was
    // completely silent: nothing dropped, no failure, no roll-up (the batch
    // roll-up only fires on `failures.length > 0`). A prompt that asked for 6
    // graphics and got 3 shipped a 9-of-12 batch with no line anywhere saying
    // so. Compare what came back against what was requested, per kind.
    const requestedByKind = {
      video: effectiveVideoCount,
      carousel: effectiveCarouselCount,
      single: effectiveSingleCount,
    } as const;
    const plannedByKind = { video: 0, carousel: 0, single: 0 };
    for (const item of validation.items) plannedByKind[item.kind] += 1;
    const shortfalls = (
      Object.keys(requestedByKind) as (keyof typeof requestedByKind)[]
    ).filter((kind) => plannedByKind[kind] < requestedByKind[kind]);
    if (shortfalls.length > 0) {
      logger.warn('Monthly plan under-produced against requested counts', {
        organizationId,
        periodMonth,
        requested: requestedByKind,
        planned: plannedByKind,
        // A shortfall with no drops means the MODEL returned fewer items;
        // with drops, validation removed them and `drops` above says why.
        droppedCount: validation.dropped.length,
        allowStockFootage,
        mediaServiceCount: mediaServiceIds.size,
        videoFootageServiceCount: videoFootageServiceIds.size,
      });
    }

    // Only a fully empty plan is a hard failure — one or more ineligible picks
    // degrade to a smaller batch rather than failing the whole month.
    if (validation.items.length === 0) {
      // If the org had no eligible candidates going in (no media-backed
      // services for graphics AND no footage-backed services for videos, so
      // every effective count clamped to zero), an empty plan is the expected
      // outcome of the org's state — not an internal failure. The clamps
      // above already info-logged the reason.
      const targetItemCount =
        effectiveVideoCount + effectiveCarouselCount + effectiveSingleCount;
      if (targetItemCount === 0) {
        return err(
          new FeatureError(
            ErrorCodes.INVALID_STATE,
            'No services with usable media or video footage to plan content for'
          )
        );
      }

      logError(
        'monthlyContentPlan.planMonthlyContent',
        new Error('Plan validation left no usable items'),
        {
          feature: 'monthly-content-plan',
          extra: {
            organizationId,
            periodMonth,
            dropped: validation.dropped,
            raw: result.raw,
          },
        }
      );
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Plan validation produced no usable content items'
        )
      );
    }

    return ok({
      organizationId,
      periodMonth,
      items: validation.items,
    });
  } catch (error) {
    if (isRateLimitError(error)) {
      return err(new FeatureError(ErrorCodes.RATE_LIMITED, RATE_LIMIT_MESSAGE));
    }
    logError('monthlyContentPlan.planMonthlyContent', error, {
      feature: 'monthly-content-plan',
      extra: { organizationId, periodMonth },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to generate monthly content plan'
      )
    );
  }
};

/**
 * The unified topic planner. One Claude call decides:
 *   - which services to advertise this month
 *   - in which modality (video / carousel / single)
 *   - what topic for each
 *
 * Output is the canonical month plan the dispatcher fans out.
 *
 * This is the "what" half of the monthly content pipeline. The "how"
 * lives downstream in modality-specific detail planners (`planVideoDetail`
 * in `videos`, `planImageDetail` in `image-generation`).
 */
export const planMonthlyContent = (
  db: DbConnection,
  input: PlanMonthlyContentInput
) =>
  trackedResult(
    'monthlyContentPlan.planMonthlyContent',
    () => planMonthlyContentImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        periodMonth: input.periodMonth,
      },
    }
  );

export type PlanMonthlyContentResult = Awaited<
  ReturnType<typeof planMonthlyContent>
>;
