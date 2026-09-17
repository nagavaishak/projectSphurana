import {
  type Video,
  type VideoDraftConfig,
  asset,
  video,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import type { Queue } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import { claimRotatedAsset } from '../../../assets/index.js';
import { recordProvenanceSafe } from '../../../content-provenance/index.js';
import {
  type VideoRenderJobInput,
  type VideoRenderJobPayload,
  closeJobQueue,
  enqueueJob,
  getJobQueue,
  videoRenderJob,
  videoRenderQueue,
} from '../../../jobs/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { getDeadLetterQueue as getSharedDeadLetterQueue } from '../../../shared/queue/index.js';
import {
  primeStockRotation,
  reportFootageGap,
  selectStockBRoll,
} from '../../../stock-footage/index.js';
import {
  type QueueVideoExportInput,
  VIDEO_PRIORITY,
  queueVideoExportSchema,
} from './queue-video-export.schema.js';

/**
 * Templates whose b-roll is real before/after results — these stay
 * upload-gated and are never auto-filled with stock (real results only, and
 * Meta restricts health before/after imagery). Everything else can take stock
 * ambient b-roll when the org hasn't uploaded its own footage.
 */
function requiresRealFootage(variationId?: string | null): boolean {
  return !!variationId && variationId.startsWith('before-after');
}

// Queue names — derived from the ONE declaration in `jobs/queues.ts`. This
// string used to be a bare literal in 9 files.
const VIDEO_RENDER_QUEUE = videoRenderQueue.name;
const VIDEO_RENDER_DLQ = `${videoRenderQueue.name}-dlq`;

export const pendingBrollClipsMessage =
  'Some b-roll clips are still processing. Please wait a moment and try again.';
export const failedBrollClipsMessage =
  'Some b-roll clips could not be prepared. Replace or re-upload them before rendering.';
export const unavailableBrollClipsMessage =
  'Some b-roll clips are no longer available. Replace them before rendering.';

type BRollAssetValidationError = {
  code: typeof ErrorCodes.VALIDATION_ERROR | typeof ErrorCodes.INVALID_STATE;
  message: string;
  details: Record<string, string[]>;
};

/**
 * Verify that every configured b-roll reference can actually become a scene.
 *
 * A non-empty `bRollClips` array is only syntactically complete. Asset rows
 * can be removed after a draft is saved, leaving a list of IDs that the worker
 * silently drops while resolving assets. Text-only videos then reach Remotion
 * with text but no visual scene. Keep this check at enqueue boundaries, before
 * a job can consume retries and produce an operational error.
 *
 * Scoped to `organizationId` so "unavailable" means "not this org's asset",
 * not merely "not found anywhere" — an ID belonging to another tenant must
 * report the same replace-it error as a deleted one, with or without RLS.
 */
export async function validateBRollAssetsForRender(
  db: DbConnection,
  organizationId: string,
  bRollClips: VideoDraftConfig['bRollClips'] | null | undefined
): Promise<BRollAssetValidationError | null> {
  const bRollAssetIds = [
    ...new Set(
      (bRollClips ?? [])
        .map((clip) => clip.assetId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ),
  ];

  // Structural validation reports an empty list with the narration-specific
  // message. Avoid a needless asset query in that case.
  if (bRollAssetIds.length === 0) return null;

  const bRollAssets = await db.query.asset.findMany({
    where: and(
      inArray(asset.id, bRollAssetIds),
      eq(asset.organizationId, organizationId)
    ),
    columns: { id: true, transcodeStatus: true },
  });
  const foundAssetIds = new Set(bRollAssets.map((row) => row.id));
  const unavailableAssetIds = bRollAssetIds.filter(
    (assetId) => !foundAssetIds.has(assetId)
  );

  if (unavailableAssetIds.length > 0) {
    return {
      code: ErrorCodes.VALIDATION_ERROR,
      message: unavailableBrollClipsMessage,
      details: { unavailableAssetIds },
    };
  }

  const failedAssetIds = bRollAssets
    .filter((row) => row.transcodeStatus === 'failed')
    .map((row) => row.id);
  if (failedAssetIds.length > 0) {
    return {
      code: ErrorCodes.INVALID_STATE,
      message: failedBrollClipsMessage,
      details: { failedAssetIds },
    };
  }

  const pendingAssetIds = bRollAssets
    .filter((row) => row.transcodeStatus === 'pending')
    .map((row) => row.id);
  if (pendingAssetIds.length > 0) {
    return {
      code: ErrorCodes.INVALID_STATE,
      message: pendingBrollClipsMessage,
      details: { pendingAssetIds },
    };
  }

  return null;
}

/**
 * Get the video render queue instance.
 * Options (attempts: 3, exponential backoff) live on the queue declaration, so
 * every producer — including the retry path — gets the same retry policy.
 */
function getVideoQueue(): Queue {
  return getJobQueue(videoRenderQueue);
}

/**
 * Get the dead letter queue instance
 * Jobs that fail after all retries are moved here for manual review
 */
export function getDeadLetterQueue(): Queue {
  return getSharedDeadLetterQueue(VIDEO_RENDER_QUEUE);
}

/**
 * Validate that draftConfig has all required fields for rendering.
 * Partial updates during the creation wizard can leave the config incomplete.
 */
export function isDraftConfigComplete(
  config: VideoDraftConfig,
  variationId?: string | null
): string | null {
  if (!config.orientation) return 'Missing orientation';
  if (!config.captions) return 'Missing captions configuration';
  // NOTE: `outro` is intentionally NOT required. Per `draftConfigSchema`,
  // organic templates render with no outro and the worker skips outro
  // assembly entirely when it's omitted. Requiring it here contradicted that
  // design and blocked every organic video (manual + monthly batch) at
  // enqueue. Ad/talking-head templates still set one; this just stops the
  // check from rejecting a legitimately outro-less organic draft.
  if (config.musicVolume === undefined || config.musicVolume === null)
    return 'Missing music volume';
  if (!Array.isArray(config.bRollClips)) return 'Missing b-roll clips array';

  // narrationType MUST be explicitly set — prevents silent pass-through
  if (!config.narrationType) {
    return 'Missing narration type (must be "recorded" or "ai_voiceover")';
  }

  // For recorded narration, require a non-empty talking head URL
  if (config.narrationType === 'recorded') {
    if (
      !config.talkingHeadUrl ||
      typeof config.talkingHeadUrl !== 'string' ||
      config.talkingHeadUrl.trim() === ''
    ) {
      return 'Missing talking head video for recorded narration';
    }
  }

  // For AI voiceover, require voice ID, script, and at least one b-roll clip
  if (config.narrationType === 'ai_voiceover') {
    if (!config.aiVoiceId) return 'Missing AI voice ID for voiceover';
    if (!config.scriptText) return 'Missing script text for AI voiceover';
    if (config.bRollClips.length === 0) {
      return 'AI voiceover videos require at least one b-roll clip for visual content';
    }
  }

  // For text_only, mirror the DEPLOYED v1 worker's pre-flight (the
  // `buildVideoConfig` content gate in `apps/video-worker/src/main.ts`) so a
  // broken config is rejected at enqueue (clear validation error, video stays
  // editable) instead of throwing mid-render (ENG-379 / ENG-321). A render
  // failure here is worse than a 500: BullMQ retries the impossible job ~6×,
  // wedging the queue and flooding error tracking with the
  // "text_only mode requires text frames, an offer card, or an organic template
  // config" throw (PostHog issue 019ed0cc — 2 stuck videos, 12 occurrences).
  //
  // IMPORTANT: this gate must NOT be MORE permissive than the worker. It used
  // to exempt `before-after-*` and `educational-*` from the text-frame
  // requirement, but the v1 `buildVideoConfig` gate has NO such exemption — it
  // demands textFrames, an offerCard, or an organic config for EVERY text_only
  // draft. A before-after / educational text_only draft with empty textFrames
  // therefore passed this gate and then threw in the worker on every retry.
  // Educational's scriptText→textFrames fallback in the worker runs AFTER that
  // throw, so it never saves these drafts. Keep the two gates in lock-step:
  // require renderable content for all text_only variations, with no
  // per-variation exemptions.
  if (config.narrationType === 'text_only') {
    const hasOfferCard = !!config.offerCard;
    const hasTextFrames = !!config.textFrames && config.textFrames.length > 0;
    // Organic templates store their copy in template-specific config objects
    // (not textFrames). Mirror the worker preflight (main.ts) so these aren't
    // rejected at enqueue. Each organic variation carries its own config key.
    const hasOrganicConfig =
      (variationId === 'caption-tease-1' && !!config.captionTease) ||
      (variationId === 'fade-benefits-1' && !!config.fadeBenefits) ||
      // highlight-caption reuses the fade-benefits config block.
      (variationId === 'highlight-caption-1' && !!config.fadeBenefits) ||
      (variationId === 'aesthetic-line-1' && !!config.aestheticLine) ||
      (variationId === 'numbered-list-1' && !!config.numberedList) ||
      (variationId === 'ins-outs-1' && !!config.insOuts) ||
      (variationId === 'question-cta-1' && !!config.questionCta) ||
      // curiosity-hook reuses the question-cta config block.
      (variationId === 'curiosity-hook-1' && !!config.questionCta) ||
      (variationId === 'improves-1' && !!config.improves) ||
      (variationId === 'step-timer-1' && !!config.stepTimer) ||
      (variationId === 'time-progress-1' && !!config.timeProgress) ||
      (variationId === 'poll-1' && !!config.poll) ||
      (variationId === 'myth-fact-1' && !!config.mythFact) ||
      (variationId === 'versus-1' && !!config.versus) ||
      (variationId === 'price-reveal-1' && !!config.priceReveal) ||
      (variationId === 'client-question-1' && !!config.clientQuestion) ||
      (variationId === 'come-with-me-1' && !!config.comeWithMe);

    if (config.bRollClips.length === 0) {
      return 'Text-only videos require at least one b-roll clip for visual content';
    }
    if (!hasOfferCard && !hasTextFrames && !hasOrganicConfig) {
      return 'Text-only videos require text frames, an offer card, or organic template copy';
    }
  }

  return null;
}

/** How many clips a render-time auto-fill produces (matches selectStockBRoll). */
const EXPORT_FILL_CLIP_COUNT = 5;

/**
 * Fill an empty b-roll list at export time — the SECOND footage selector.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE PLANNER
 * -------------------------------------------
 * `plan-video-detail` chooses footage when a batch plans a video. This path
 * runs when a video reaches export with no clips at all — a draft created
 * through Claire or the wizard rather than a batch. Two selectors, one job.
 *
 * They had drifted completely. The planner gained rotation, a quality floor and
 * provenance; this one kept calling `selectStockBRoll` directly, which has
 * none of the three. So a video filled here drew stock in a fixed order, used a
 * blurry or shaky clip as readily as a good one, and — worst for debugging —
 * wrote NO provenance row, so afterwards there was no record of what was
 * considered or why. A real report of "body contouring video, last clip is a
 * facial" landed on a video this path had filled, and nothing stored could
 * explain it.
 *
 * That is the exact failure the capability registry exists to stop, in the
 * selection layer rather than the editing layer: fixing the reported symptom on
 * one path while an adjacent path keeps the old behaviour and no test notices.
 *
 * So it now runs the same claim the planner does, and falls back to the direct
 * stock selector only when the rotation pool yields nothing.
 */
async function fillBRollForExport(
  db: DbConnection,
  args: {
    videoId: string;
    organizationId: string;
    serviceId: string | null;
    createdById: string;
    /**
     * Take service-MATCHED footage only, and stop there.
     *
     * The rotation claim below draws on `service_stock_clip` — the matcher's
     * ranked picks for this service — so it is already adaptive: a service with
     * two matches yields two clips and the loop breaks. What is NOT adaptive is
     * the generic fallback underneath it, which fills to a fixed count from the
     * vertical's ambient pool. That pool is documented, accurately, as the path
     * that can put a facial in a body-contouring video.
     *
     * At EXPORT that trade is right: a render that happens with a neutral
     * clinic shot beats a render that does not happen.
     *
     * On the CARD it is wrong, because the card lists these clips to the owner
     * as the clips in their video. Filling to five with ambient footage put a
     * dentist in red scrubs in a microneedling video and asked the owner to
     * approve it. So the card asks for matched only and takes however many
     * there are — every template's b-roll slot declares `count: [1, N]`, so a
     * short list is a legal render and the engine holds each clip longer.
     */
    matchedOnly?: boolean;
  }
): Promise<VideoDraftConfig['bRollClips']> {
  const { videoId, organizationId, serviceId, createdById, matchedOnly } = args;

  const claimedIds: string[] = [];
  let poolSize = 0;
  let excludedForQuality = 0;

  // Rotation is keyed on the service; without one there is nothing to rotate
  // over and the direct selector's generic pool is the only option.
  if (serviceId) {
    await primeStockRotation(db, {
      organizationId,
      serviceId: serviceId ?? undefined,
      uploadedById: createdById,
      count: EXPORT_FILL_CLIP_COUNT,
      mediaType: 'video',
    });

    for (let i = 0; i < EXPORT_FILL_CLIP_COUNT; i += 1) {
      const claim = await claimRotatedAsset(db, {
        organizationId,
        serviceId,
        excludeAssetIds: claimedIds,
        requireThumbnail: false,
        mediaType: 'video',
        requireTranscodeReady: true,
      });
      if (!claim.success) break;
      poolSize = Math.max(poolSize, claim.data.poolSize);
      excludedForQuality = Math.max(
        excludedForQuality,
        claim.data.excludedForQuality
      );
      if (!claim.data.assetId) break;
      claimedIds.push(claim.data.assetId);
    }
  }

  if (claimedIds.length > 0) {
    // A CLIP IS NEVER REPEATED WITHIN A VIDEO — see the same rule in
    // plan-video-detail. This filled to EXPORT_FILL_CLIP_COUNT by cycling
    // (`claimedIds[i % claimedIds.length]`), which is what put the same
    // forehead clip on screen twice in a three-clip botox video.
    //
    // Every template's b-roll slot declares `count: [1, N]`, so a short list is
    // a legal render; the engine holds each clip longer rather than failing.
    const clips = claimedIds
      .slice(0, EXPORT_FILL_CLIP_COUNT)
      .map((assetId, i) => ({
        assetId,
        order: i,
        clipType: 'bRoll' as const,
      }));

    // Classify by what the viewer actually opens on, rather than by which
    // branch ran — a rotation claim can return the org's own clip or a stock
    // one, and recording "rotation" for both would lose the distinction that
    // makes the stock share countable.
    //
    // Fetching every claimed clip's source rather than just the opener's also
    // yields the own/stock split, which is what says whether this render came
    // from the business at all.
    const claimedSources = await db
      .select({ id: asset.id, source: asset.source })
      .from(asset)
      .where(inArray(asset.id, claimedIds));
    const openingSource = claimedSources.find(
      (a) => a.id === clips[0].assetId
    )?.source;
    const ownClipCount = claimedSources.filter(
      (a) => a.source !== 'stock'
    ).length;

    reportFootageGap({
      organizationId,
      serviceId: serviceId as string,
      ownClipCount,
      stockPoolSize: poolSize,
      excludedForQuality,
      selector: 'queue-video-export.autoFill',
      subjectId: videoId,
    });

    await recordProvenanceSafe(db, {
      organizationId,
      subjectType: 'video',
      subjectId: videoId,
      serviceId: serviceId ?? undefined,
      chosenAssetId: clips[0]?.assetId,
      mediaSource:
        openingSource === 'stock' ? 'stock' : 'service-video-thumbnail',
      candidatesConsidered: claimedIds,
      detail: {
        selector: 'queue-video-export.autoFill',
        footageSource: 'rotation',
        poolSize,
        excludedForQuality,
        // Not a failure — a measurement. "Wanted 3, got 2" is the signal that
        // says where footage is thin, and it is what should surface a
        // two-clip pool before a customer does.
        clipShortfall: Math.max(0, EXPORT_FILL_CLIP_COUNT - clips.length),
        clipAssetIds: clips.map((c) => c.assetId),
      },
    });
    return clips;
  }

  // Nothing claimable: no service, an unprimed pool, or every candidate below
  // the floor.
  //
  // `matchedOnly` stops here and returns nothing, which is the honest answer
  // for a surface that is about to show the owner what is in their video. The
  // card then says no footage matched this service and offers the picker,
  // rather than presenting ambient clips as if they had been chosen.
  if (matchedOnly) return [];

  // The direct selector still gets the video rendered — it can draw on the
  // GENERIC pool, which rotation deliberately will not enrol.
  const filled = await selectStockBRoll(db, {
    organizationId,
    // Passed through as-is: the selector accepts null and treats it as "no
    // service", which is exactly the case that lands here.
    serviceId,
    uploadedById: createdById,
    count: EXPORT_FILL_CLIP_COUNT,
  });
  if (!filled.success || filled.data.length === 0) return [];

  await recordProvenanceSafe(db, {
    organizationId,
    subjectType: 'video',
    subjectId: videoId,
    serviceId: serviceId ?? undefined,
    chosenAssetId: filled.data[0]?.assetId,
    mediaSource: 'stock',
    detail: {
      selector: 'queue-video-export.autoFill',
      // Named distinctly from 'stock' so the generic-pool fallback is
      // countable: it is the path that can put a facial in a body-contouring
      // video, and it must be visible when it fires.
      footageSource: 'stock-direct-fallback',
      poolSize,
      excludedForQuality,
      clipAssetIds: filled.data.map((c) => c.assetId),
    },
  });
  return filled.data;
}

/**
 * Give a draft its footage, if it has none and is entitled to some.
 *
 * Returns the updated config when it filled, or null when there was nothing to
 * do — the draft already has clips, or its template wants real footage, or its
 * narration does not use b-roll at all.
 *
 * WHY THIS IS EXPORTED, and why CREATE calls it too.
 *
 * It used to run at export only, which was the right place for a renderer and
 * the wrong place for a person. A draft was created with `bRollClips: []`, so
 * the card in chat said "B-roll (0 / min 1) — pick at least 1 clip before
 * rendering", and the owner was asked to assemble a video the server was
 * perfectly capable of assembling. The clips they eventually picked were then
 * often replaced by this very function anyway.
 *
 * Filling at CREATE puts the same clips on screen that the render would have
 * used, which is what makes an approval meaningful: the owner is looking at the
 * actual video and saying yes to it, rather than being handed an empty tray and
 * a chore.
 *
 * Export still calls it, and must — a draft can reach export without ever
 * passing a card (Quick Create, WhatsApp, a fill that came back empty because
 * the bank had nothing matching at the time). It is idempotent: a draft that
 * already has clips returns null and is left alone.
 */
export async function ensureBRollClips(
  db: DbConnection,
  currentVideo: Pick<
    Video,
    | 'id'
    | 'organizationId'
    | 'serviceId'
    | 'createdById'
    | 'variationId'
    | 'draftConfig'
  >,
  options?: { matchedOnly?: boolean }
): Promise<VideoDraftConfig | null> {
  const dc = currentVideo.draftConfig;
  if (!dc) return null;

  const currentBRollClips = Array.isArray(dc.bRollClips) ? dc.bRollClips : [];
  const stockEligible =
    currentBRollClips.length === 0 &&
    !!currentVideo.createdById &&
    !requiresRealFootage(currentVideo.variationId) &&
    (dc.narrationType === 'ai_voiceover' || dc.narrationType === 'text_only');

  if (!stockEligible) return null;

  const filled = await fillBRollForExport(db, {
    videoId: currentVideo.id,
    organizationId: currentVideo.organizationId,
    serviceId: currentVideo.serviceId,
    createdById: currentVideo.createdById as string,
    matchedOnly: options?.matchedOnly,
  });
  if (filled.length === 0) return null;

  const updatedConfig = { ...dc, bRollClips: filled };
  await db
    .update(video)
    .set({ draftConfig: updatedConfig })
    .where(eq(video.id, currentVideo.id));
  return updatedConfig;
}

/**
 * Internal implementation of queue video export
 */
const queueVideoExportImpl = async (
  db: DbConnection,
  input: QueueVideoExportInput
): Promise<Result<Video>> => {
  // Validate input
  const parsed = queueVideoExportSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Get the current video to verify it exists and is in draft status
  const [currentVideo] = await db
    .select()
    .from(video)
    .where(eq(video.id, parsed.data.id))
    .limit(1);

  if (!currentVideo) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Video not found', {
        videoId: parsed.data.id,
      })
    );
  }

  if (currentVideo.status !== 'draft') {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        `Video cannot be queued. Current status: ${currentVideo.status}`,
        { currentStatus: currentVideo.status }
      )
    );
  }

  if (!currentVideo.draftConfig) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Video has no draft configuration. Please complete the video setup first.',
        { videoId: parsed.data.id }
      )
    );
  }

  // See `fillBRollForExport` — the second footage selector, now on the same
  // rotation path as the planner's.
  //
  // Auto-fill b-roll from the curated stock bank when the draft has no clips.
  // The UI toggle only controls browsing/hand-picking stock; an empty b-roll
  // list must still render by using AI-matched stock for stock-eligible
  // templates. before/after templates (real results only) and recorded
  // talking-head videos are excluded; only narration types that actually
  // require b-roll are filled. Runs inside the surrounding withOrgScope tx, so
  // minted assets are org-owned (RLS-safe).
  const filledConfig = await ensureBRollClips(db, currentVideo);
  if (filledConfig) currentVideo.draftConfig = filledConfig;

  // Validate draftConfig completeness before queueing for render
  const configError = isDraftConfigComplete(
    currentVideo.draftConfig,
    currentVideo.variationId
  );
  if (configError) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        `Video configuration is incomplete: ${configError}`,
        { videoId: parsed.data.id, configError }
      )
    );
  }

  // Gate: reject the render if any b-roll clip hasn't finished its transcode
  // pipeline. This prevents Remotion chunks from OOM-ing on 4K/HEVC source
  // files while their normalized H.264 copy is still being produced.
  const bRollAssetError = await validateBRollAssetsForRender(
    db,
    currentVideo.organizationId,
    currentVideo.draftConfig.bRollClips
  );
  if (bRollAssetError) {
    return err(
      new FeatureError(bRollAssetError.code, bRollAssetError.message, {
        videoId: parsed.data.id,
        ...bRollAssetError.details,
      })
    );
  }

  try {
    // Update status to queued
    const [updatedVideo] = await db
      .update(video)
      .set({
        status: 'queued',
        progress: 0,
        errorMessage: null, // Clear any previous error
      })
      .where(eq(video.id, parsed.data.id))
      .returning();

    // Add job to the BullMQ queue with the draft config.
    // The video-worker will build the full VideoConfig from this.
    //
    // Every field of the payload is spelled out because the declaration makes
    // them required-and-nullable: you cannot *forget* `theme` here, you can
    // only decide it. (This is a v1 enqueue from the draft — the worker's
    // compiler resolves the theme from the org's brand kit.)
    // A render for this video may already exist in Redis under this exact
    // jobId. BullMQ treats `add()` with a duplicate jobId as a SILENT no-op —
    // it returns a Job object for the old record and enqueues nothing — so
    // without this, the SECOND render of any video does nothing at all: the row
    // flips to `queued`, no job runs, and the video sits on the old cut
    // forever. That is what made "change the first clip" in the review thread
    // stage an edit, say it would apply on the next render, and then never
    // re-render.
    //
    // Retention decides how long the ghost lingers, and both settings are
    // unkind here: `removeOnComplete: 100` hides the bug behind a busy queue
    // (it fixes itself once 100 newer renders evict the record, which is why
    // this looks intermittent), while `removeOnFail: false` keeps failures
    // FOREVER — a video whose render ever failed could never be re-rendered.
    //
    // A job still WAITING or ACTIVE is different: that is a render genuinely in
    // flight, and collapsing a double-press onto it is the dedup we want. So
    // only terminal records are cleared. `Job.remove()` refuses to remove a
    // locked job, so the guard is belt-and-braces.
    const renderQueue = getJobQueue(videoRenderQueue);
    const priorJob = await renderQueue.getJob(parsed.data.id);
    if (priorJob) {
      const state = await priorJob.getState();
      if (state === 'completed' || state === 'failed') {
        await priorJob.remove().catch((error: unknown) => {
          // Losing the race with retention is fine — the add below succeeds
          // either way. Anything else is worth knowing about.
          logError('videos.queueVideoExport.removeStaleJob', error, {
            feature: 'videos',
            extra: { videoId: parsed.data.id, state },
          });
        });
      }
    }

    await enqueueJob(
      videoRenderJob,
      {
        videoId: parsed.data.id,
        organizationId: currentVideo.organizationId,
        draftConfig: currentVideo.draftConfig,
        // Include variationId for variation-specific rendering logic
        variationId: currentVideo.variationId ?? null,
        templateId: currentVideo.templateId ?? null,
        createdById: currentVideo.createdById ?? null,
        schemaVersion: 1,
        templateDocId: null,
        skipCompile: false,
        theme: null,
        synthesisOverrides: currentVideo.synthesisOverrides ?? null,
        whatsappDelivery: parsed.data.whatsappDelivery ?? null,
      },
      {
        jobId: parsed.data.id, // Use video ID as job ID for easy lookup
        priority: parsed.data.priority, // Lower number = higher priority
      }
    );

    return ok(updatedVideo);
  } catch (error) {
    logError('videos.queueVideoExport', error, {
      feature: 'videos',
      extra: { videoId: parsed.data.id },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to queue video for export'
      )
    );
  }
};

/**
 * Queue a video for export/rendering
 * Changes status from 'draft' to 'queued' and adds job to BullMQ queue
 *
 * The job will be picked up by the video-worker app which uses
 * Remotion Lambda for serverless video rendering.
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Queue video export input with video ID
 * @returns Result with updated video or error
 */
export const queueVideoExport = async (
  db: DbConnection,
  input: QueueVideoExportInput
) => {
  return trackedResult(
    'videos.queueVideoExport',
    () => withOrgScope((tx) => queueVideoExportImpl(tx, input), { db }),
    {
      properties: { videoId: input.id },
      // The rejection paths (already queued/rendered, incomplete draft, or
      // footage still transcoding) are deliberate state-machine responses,
      // not server faults. Keep the Sentry breadcrumb for investigation while
      // avoiding error telemetry for expected 4xx outcomes.
      internalErrorsOnly: true,
    }
  );
};

/**
 * Result type for queueVideoExport
 */
export type QueueVideoExportResult = Awaited<
  ReturnType<typeof queueVideoExport>
>;

/**
 * Check if a video rendering job exists in the queue
 */
export async function getJobStatus(videoId: string) {
  const queue = getVideoQueue();
  const job = await queue.getJob(videoId);

  if (!job) {
    return null;
  }

  const state = await job.getState();
  const progress = job.progress;

  return {
    jobId: job.id,
    state,
    progress: typeof progress === 'number' ? progress : 0,
    failedReason: job.failedReason,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
  };
}

/**
 * Close the queue connection (for graceful shutdown)
 */
export async function closeVideoQueue(): Promise<void> {
  await closeJobQueue(videoRenderQueue);
}

// =============================================================================
// Dead Letter Queue Management
// =============================================================================

/**
 * Move a failed job to the dead letter queue
 * Called by the video-worker when a job fails after all retries
 */
export async function moveToDeadLetterQueue(originalJob: {
  id: string;
  data: VideoRenderJobPayload;
  failedReason?: string;
  attemptsMade: number;
}): Promise<void> {
  const dlq = getDeadLetterQueue();
  await dlq.add(
    'failed-render',
    {
      originalJobId: originalJob.id,
      // Spread the whole payload rather than re-listing its fields: the DLQ
      // copy used to be a hand-written subset, so replaying from the DLQ could
      // only ever restore the fields someone remembered to add here.
      ...originalJob.data,
      failedReason: originalJob.failedReason || 'Unknown error',
      attemptsMade: originalJob.attemptsMade,
      failedAt: new Date().toISOString(),
    },
    {
      jobId: `dlq-${originalJob.id}-${Date.now()}`,
    }
  );
}

/**
 * List all jobs in the dead letter queue
 */
export interface DeadLetterJob {
  id: string;
  videoId: string;
  organizationId: string;
  failedReason: string;
  attemptsMade: number;
  failedAt: string;
}

const listDeadLetterJobsImpl = async (
  limit = 20,
  offset = 0
): Promise<Result<{ jobs: DeadLetterJob[]; total: number }>> => {
  try {
    const dlq = getDeadLetterQueue();
    const waiting = await dlq.getWaiting(offset, offset + limit - 1);
    const counts = await dlq.getJobCounts();

    return ok({
      jobs: waiting.map((job) => ({
        id: job.id ?? '',
        videoId: job.data.videoId,
        organizationId: job.data.organizationId,
        failedReason: job.data.failedReason,
        attemptsMade: job.data.attemptsMade,
        failedAt: job.data.failedAt,
      })),
      total: counts.waiting,
    });
  } catch (error) {
    logError('videos.listDeadLetterJobs', error, { feature: 'videos' });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to list DLQ jobs')
    );
  }
};

export const listDeadLetterJobs = (limit = 20, offset = 0) =>
  trackedResult('videos.listDeadLetterJobs', () =>
    listDeadLetterJobsImpl(limit, offset)
  );

/**
 * Retry a job from the dead letter queue
 * Creates a new job in the main queue with high priority
 */
const retryFromDeadLetterQueueImpl = async (
  dlqJobId: string
): Promise<Result<{ newJobId: string }>> => {
  try {
    const dlq = getDeadLetterQueue();
    const dlqJob = await dlq.getJob(dlqJobId);

    if (!dlqJob) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'DLQ job not found'));
    }

    // Replay the DLQ'd job. Every replay-critical field is carried across —
    // `theme` and `synthesisOverrides` included — because the payload
    // declaration will not let us drop them.
    const newJob = await enqueueJob(
      videoRenderJob,
      {
        videoId: dlqJob.data.videoId,
        organizationId: dlqJob.data.organizationId,
        draftConfig: dlqJob.data.draftConfig,
        variationId: dlqJob.data.variationId ?? null,
        templateId: dlqJob.data.templateId ?? null,
        createdById: dlqJob.data.createdById ?? null,
        schemaVersion: dlqJob.data.schemaVersion === 2 ? 2 : 1,
        templateDocId: dlqJob.data.templateDocId ?? null,
        skipCompile: dlqJob.data.schemaVersion === 2,
        theme: dlqJob.data.theme ?? null,
        synthesisOverrides: dlqJob.data.synthesisOverrides ?? null,
        whatsappDelivery: dlqJob.data.whatsappDelivery ?? null,
      },
      {
        jobId: `retry-${dlqJob.data.videoId}-${Date.now()}`,
        priority: VIDEO_PRIORITY.HIGH, // High priority for retries
      }
    );

    // Remove from DLQ after successful re-queue
    await dlqJob.remove();

    return ok({ newJobId: newJob.id ?? '' });
  } catch (error) {
    logError('videos.retryFromDeadLetterQueue', error, {
      feature: 'videos',
      extra: { dlqJobId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to retry DLQ job')
    );
  }
};

export const retryFromDeadLetterQueue = (dlqJobId: string) =>
  trackedResult('videos.retryFromDeadLetterQueue', () =>
    retryFromDeadLetterQueueImpl(dlqJobId)
  );

/**
 * Get dead letter queue stats
 */
export interface DlqStats {
  waiting: number;
  delayed: number;
  completed: number;
}

const getDeadLetterQueueStatsImpl = async (): Promise<Result<DlqStats>> => {
  try {
    const dlq = getDeadLetterQueue();
    const counts = await dlq.getJobCounts();
    return ok({
      waiting: counts.waiting,
      delayed: counts.delayed,
      completed: counts.completed,
    });
  } catch (error) {
    logError('videos.getDeadLetterQueueStats', error, { feature: 'videos' });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to get DLQ stats')
    );
  }
};

export const getDeadLetterQueueStats = () =>
  trackedResult('videos.getDeadLetterQueueStats', () =>
    getDeadLetterQueueStatsImpl()
  );

// Export queue names for worker
export { VIDEO_RENDER_QUEUE, VIDEO_RENDER_DLQ };
export type { VideoRenderJobPayload };

/**
 * Low-level enqueue for callers that already hold a complete payload (the
 * v2 synthesizer). Takes `z.input` of the ONE declaration — so it cannot be
 * called with a payload that is missing a replay-critical field.
 */
export async function enqueueVideoRender(
  payload: VideoRenderJobInput
): Promise<void> {
  await enqueueJob(videoRenderJob, payload, { jobId: payload.videoId });
}
