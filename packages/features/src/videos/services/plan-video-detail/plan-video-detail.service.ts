import { randomUUID } from 'node:crypto';
import {
  type BRollClipConfig,
  type VideoDraftConfig,
  type VideoIdea,
  contentAttempt,
  contentItem,
  organizationService,
} from '@borradh-workspace/database';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { claimRotatedAsset } from '../../../assets/services/claim-rotated-asset/index.js';
import { listAssetsByService } from '../../../assets/services/list-assets-by-service/index.js';
import { recordProvenanceSafe } from '../../../content-provenance/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { generatePostCaption } from '../../../social-posts/services/generate-post-caption/index.js';
import {
  primeStockRotation,
  reportFootageGap,
  selectStockBRoll,
} from '../../../stock-footage/index.js';
import { dedupeBRollClips } from '../../broll-clips.js';
import {
  inferVideoRegenerationIntent,
  inputsForVideoIntent,
} from '../../regeneration-intent.js';
import {
  type ContentIdeaTemplate,
  type TemplateVariation,
  getPlannableOrganicTemplates,
  getTemplateById,
} from '../../templates/index.js';
import { createVideo } from '../create-video/index.js';
import {
  type GeneratedOrganicCopy,
  type OrganicVariationId,
  generateOrganicCopy,
  organicCopyToConfigBlock,
} from '../generate-organic-copy/index.js';
import {
  type OrganicTemplateId,
  generateVideoIdea,
} from '../generate-video-idea/index.js';
import { queueVideoExport } from '../queue-video-export/index.js';
import {
  type PlanVideoDetailInput,
  planVideoDetailSchema,
} from './plan-video-detail.schema.js';

const logger = createLogger('PlanVideoDetail');

/**
 * How many DISTINCT b-roll clips to hand the renderer.
 *
 * Deliberately above `recommendedClipCount` (2-4). That field describes how the
 * video should FEEL; it does not predict how many scenes get built. The beat
 * grid and the copy length do, and both routinely exceed it — 6 scenes from a
 * 3-clip recommendation was measured in production data.
 *
 * Surplus is free: the renderer uses what it needs. A shortfall is a repeated
 * clip on screen. So aim high and let `clipShortfall` report what the bank
 * could not supply.
 */
const CLIP_SUPPLY_TARGET = 8;

export interface PlanVideoDetailResponse {
  /** content_batch_item.id created for this slot */
  itemId: string;
  /** video.id of the queued draft video */
  videoId: string;
}

/**
 * Plan + queue a single organic video for one slot in the monthly content
 * batch. The unified topic planner upstream (in `monthly-content-plan`) has
 * already picked the service + topic for this slot; this service does the
 * modality-specific work:
 *
 *   1. generateVideoIdea (single LLM call, structured idea)
 *   2. fan-out: generateOrganicCopy (on-screen) + generatePostCaption (caption)
 *      in parallel — both seeded by the same idea so they stay coherent.
 *   3. resolve b-roll footage (service-linked clips, padded from the general
 *      video pool).
 *   4. createVideo + queueVideoExport.
 *   5. insert content_batch_item with caption / scheduledAt / targetPageIds /
 *      videoIdea.
 *
 * This is the refactor of what used to be `seedSlot` inside
 * `content-batches/generate-monthly-batch.service.ts`. Topic-selection logic
 * (which template + which service + the scheduledAt offset) has been LIFTED
 * OUT to the unified planner; this service only takes those decisions as
 * inputs.
 *
 * `generateMonthlyBatch` still exists and still calls the original
 * `buildBatchPlan` to pick services per slot; the new path is the
 * dispatcher in `monthly-content-plan` calling this service directly.
 */
const planVideoDetailImpl = async (
  db: DbConnection,
  input: PlanVideoDetailInput
): Promise<Result<PlanVideoDetailResponse>> => {
  const parsed = planVideoDetailSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    createdById,
    batchId,
    periodMonth,
    targetServiceId,
    position,
    scheduledAt,
    templateId: templateIdInput,
    variationId: variationIdInput,
    targetPageIds,
    cdnUrl,
    allowStockFootage,
    regeneration,
  } = parsed.data;

  // ── 0. Resolve the regeneration intent ────────────────────────────────
  //
  // Declared by the caller where possible; inferred only as a compatibility
  // shim for callers that predate the field. Everything downstream reads the
  // INPUTS TABLE rather than testing `regeneration` directly, so what an
  // intent preserves lives in one place and tuning one cannot silently break
  // another. See videos/regeneration-intent.ts.
  const regenerationInputs = regeneration
    ? inputsForVideoIntent(
        regeneration.intent ??
          inferVideoRegenerationIntent({
            hasPriorClipIds: Boolean(regeneration.priorClipAssetIds?.length),
            refinementInstruction: regeneration.refinementInstruction,
          })
      )
    : null;

  // ── 1. Resolve template + variation ───────────────────────────────────
  //
  // Either honour the dispatcher's pin or pick deterministically from the
  // organic registry. We prefer to honour the pin so reruns are
  // reproducible; falling back to the first registered template keeps the
  // service usable when the dispatcher doesn't care.
  const organicTemplates = getPlannableOrganicTemplates();
  if (organicTemplates.length === 0) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'No organic video templates are registered — cannot plan video'
      )
    );
  }

  let tpl: ContentIdeaTemplate | undefined;
  if (templateIdInput) {
    tpl = getTemplateById(templateIdInput);
    if (!tpl) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          `Unknown templateId ${templateIdInput}`
        )
      );
    }
  } else {
    tpl = organicTemplates[0];
  }

  let variation: TemplateVariation | undefined;
  if (variationIdInput) {
    variation = tpl.variations.find((v) => v.id === variationIdInput);
    if (!variation) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          `Template ${tpl.id} missing variation ${variationIdInput}`
        )
      );
    }
  } else {
    variation = tpl.variations[0];
    if (!variation) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          `Template ${tpl.id} has no variations`
        )
      );
    }
  }
  const variationId = variation.id as OrganicVariationId;

  // ── 2. Resolve service row (needed for serviceName) ───────────────────
  const serviceRow = await db.query.organizationService.findFirst({
    where: eq(organizationService.id, targetServiceId),
    columns: { id: true, name: true, organizationId: true },
  });
  if (!serviceRow || serviceRow.organizationId !== organizationId) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `targetServiceId ${targetServiceId} not found for org ${organizationId}`
      )
    );
  }

  // ── 3. Resolve the narrative idea ─────────────────────────────────────
  // An amendment reuses the original item's idea (and its caption, below) so
  // it changes only what it set out to and doesn't clobber the user's review
  // edits. `full` and fresh slots generate both.
  let idea: VideoIdea;
  if (regenerationInputs?.reuseIdea && regeneration?.reuseVideoIdea) {
    idea = regeneration.reuseVideoIdea as unknown as VideoIdea;
  } else {
    const ideaResult = await generateVideoIdea(db, {
      organizationId,
      templateId: tpl.id as OrganicTemplateId,
      serviceId: serviceRow.id,
    });
    if (!ideaResult.success) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          `Idea generation failed for ${tpl.id}: ${ideaResult.error.code}`
        )
      );
    }
    idea = ideaResult.data;
  }

  // ── 4. Fan-out: on-screen copy + post caption in parallel ─────────────
  //
  // `refineCopy` rewrites from the prior copy plus the user's change — a
  // surgical edit, not a fresh write. `reuseCopyVerbatim` skips generation
  // entirely: a FOOTAGE swap must not silently reword the video, which is what
  // regenerating the copy would do. The two are mutually exclusive by
  // construction (asserted in regeneration-intent.test.ts).
  const reuseCaption =
    regenerationInputs?.reuseCaption && regeneration?.reuseCaption !== undefined
      ? regeneration.reuseCaption
      : null;
  const carryCopyVerbatim = Boolean(
    regenerationInputs?.reuseCopyVerbatim && regeneration?.priorCopy
  );
  const [copyResult, captionResult] = await Promise.all([
    carryCopyVerbatim
      ? Promise.resolve(null)
      : generateOrganicCopy(db, {
          organizationId,
          variationId,
          serviceId: serviceRow.id,
          ...(regenerationInputs?.refineCopy
            ? {
                refinementInstruction: regeneration?.refinementInstruction,
                priorCopy: regeneration?.priorCopy,
              }
            : {}),
        }),
    regenerationInputs?.reuseCaption
      ? Promise.resolve(null)
      : generatePostCaption(db, {
          organizationId,
          idea,
        }),
  ]);
  if (copyResult && !copyResult.success) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        `Copy generation failed for ${tpl.id}: ${copyResult.error.code}`
      )
    );
  }
  if (captionResult && !captionResult.success) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        `Caption generation failed for ${tpl.id}: ${captionResult.error.code}`
      )
    );
  }
  // `priorCopy` is carried over the wire as an opaque record (it round-trips
  // through the batch item), so it is asserted back to the copy shape here.
  // Safe because the only writer is a previous run of this same planner, and
  // `pinTemplate` guarantees the variation — hence the copy block shape — is
  // unchanged. A footage swap with mismatched copy would fail the render, not
  // silently mis-render.
  const copy: GeneratedOrganicCopy =
    carryCopyVerbatim && regeneration?.priorCopy
      ? (regeneration.priorCopy as unknown as GeneratedOrganicCopy)
      : // Non-null whenever we did not carry copy verbatim: the two branches
        // are exclusive and `copyResult` is only null in the verbatim case.
        (copyResult as NonNullable<typeof copyResult>).data;
  const caption = regenerationInputs?.reuseCaption
    ? reuseCaption
    : captionResult?.success
      ? captionResult.data.caption
      : null;

  // ── 5. Resolve b-roll footage ─────────────────────────────────────────
  //
  // Never another service's pool. An organic video is about ONE service, so
  // borrowing another service's footage renders an on-screen story about
  // service A over clips of service B.
  //
  // Within that constraint, selection is a single least-recently-used claim
  // over the service's rotation pool — the org's own clips AND the curated
  // stock matched to this service, competing in one queue. It used to be a
  // fixed index-cycle over own footage with stock reachable only when a service
  // had NOTHING, which is why a service with one clip opened on that clip in
  // every video it ever produced. See `claimRotatedAsset` for why own footage
  // now wins on a tie-break rather than through a separate tier.
  const serviceAssetsResult = await listAssetsByService(db, {
    serviceId: serviceRow.id,
    organizationId,
  });
  // `listAssetsByService` excludes stock, so this is the OWN-footage count —
  // still the honest answer to "how much choice did this service have of its
  // own?", and what classifies each claimed clip below.
  //
  // Transcode readiness matches `queueVideoExport`'s render gate: a video
  // seeded with a still-transcoding clip sticks in 'draft' with nothing to
  // retry it (the "7 of 8 complete" drop). The claim applies the same gate
  // internally so the two cannot drift apart.
  const ownVideoIds = serviceAssetsResult.success
    ? serviceAssetsResult.data
        .filter(
          (a) =>
            a.type === 'video' &&
            (a.transcodeStatus === 'ready' || a.transcodeStatus === 'skipped')
        )
        .map((a) => a.id)
    : [];

  // Admit matched stock to the pool BEFORE claiming — a candidate that has
  // never been minted looks to the claim like a candidate that doesn't exist.
  // Idempotent, and scoped to this one service.
  if (allowStockFootage) {
    await primeStockRotation(db, {
      organizationId,
      serviceId: serviceRow.id,
      uploadedById: createdById,
      count: CLIP_SUPPLY_TARGET,
      mediaType: 'video',
    });
  }

  // Claim distinct clips, least-recently-used first. Each claim stamps as it
  // picks, so consecutive videos for this service walk the pool rather than
  // re-opening on the same footage.
  //
  // UNLESS this regeneration is preserving footage. `reuseClips` short-circuits
  // the claim entirely and replays the previous render's clips, because the LRU
  // stamp makes re-claiming actively AVOID them — a copy edit would otherwise
  // be guaranteed to return different b-roll. See videos/regeneration-intent.ts.
  const reusedClipIds =
    regenerationInputs?.reuseClips && regeneration?.priorClipAssetIds?.length
      ? regeneration.priorClipAssetIds
      : null;

  const claimedIds: string[] = [];
  let poolSize = 0;
  let excludedForQuality = 0;
  // Claim up to the SUPPLY target, not the recommendation. This loop was the
  // hard ceiling: a service with six eligible clips only ever had three
  // claimed, so no amount of topping up downstream could reach the scene count.
  for (let i = 0; !reusedClipIds && i < CLIP_SUPPLY_TARGET; i += 1) {
    const claim = await claimRotatedAsset(db, {
      organizationId,
      serviceId: serviceRow.id,
      // Distinct WITHIN this video; across videos the LRU order does the work.
      excludeAssetIds: claimedIds,
      // A clip slot needs footage, not a still — so no thumbnail requirement,
      // but a hard media-type filter and the render gate.
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
    // Pool exhausted for this video.
    if (!claim.data.assetId) break;
    claimedIds.push(claim.data.assetId);
  }

  let bRollClips: BRollClipConfig[];
  // Recorded as provenance + logged: "wrong footage" is the most-cited
  // complaint and until now nothing captured WHICH clips a video used, how
  // many the service actually had, or whether we fell back to stock.
  let footageSource: 'service-own' | 'stock' | 'mixed' = 'service-own';
  let clipShortfall = 0;
  /** Clips the service actually matched, before any ambient top-up. */
  let matchedClipCount = 0;
  /** Clips added from the stock/ambient ladder to reach the scene count. */
  let toppedUpClipCount = 0;
  const ownSet = new Set(ownVideoIds);

  if (reusedClipIds) {
    // Replaying the previous render's footage verbatim, in its original order.
    // No claim, so no `lastUsedAt` stamp: a copy edit must not consume the
    // service's rotation, or three refinements would burn through the pool and
    // the NEXT genuinely-new video would open on a clip it just used.
    bRollClips = reusedClipIds.map((assetId, idx) => ({
      assetId,
      order: idx,
      clipType: 'bRoll',
    }));
    const usedOwn = reusedClipIds.some((id) => ownSet.has(id));
    const usedStock = reusedClipIds.some((id) => !ownSet.has(id));
    footageSource =
      usedOwn && usedStock ? 'mixed' : usedOwn ? 'service-own' : 'stock';
  } else if (claimedIds.length > 0) {
    // A CLIP IS NEVER REPEATED WITHIN A VIDEO. This used to fill to
    // `recommendedClipCount` by cycling — `claimedIds[i % claimedIds.length]` —
    // which produced needle-forehead, syringe-forehead, needle-forehead,
    // syringe-forehead on a real botox render. The footage was correct and the
    // video looked broken.
    //
    // Nothing ever required the recommended count. Every template's b-roll slot
    // declares `count: [1, N]`, so one clip is a legal render and the engine
    // absorbs a short list by holding each clip longer. The count is a target
    // for how the video should FEEL, not a contract with the renderer, and
    // padding it with duplicates trades a real defect for a cosmetic metric.
    //
    // Supply to the RENDERER's appetite, not the template's recommendation.
    //
    // `recommendedClipCount` is 2-4. The renderer builds 4-6 scenes: the beat
    // grid decides for beat-synced templates, and copy length decides for the
    // rest — fade-benefits makes one scene per line, so five lines is five
    // scenes whatever the variation recommends. Measured on a real batch after
    // the first top-up shipped:
    //
    //   supplied 4 -> 5 scenes    supplied 3 -> 6 scenes    supplied 2 -> 4 scenes
    //
    // Every one reported `clipShortfall: 0`, because the plan hit the target it
    // had been given. The target was wrong.
    //
    // The old `.slice(0, recommendedClipCount)` made it worse: a service that
    // matched five clips had two DISCARDED, and the renderer then repeated the
    // three it was left with.
    //
    // So keep everything claimed, and top up to a ceiling above any observed
    // scene count. Surplus clips cost nothing — the renderer takes what it
    // needs and ignores the rest — while a shortfall is visible in the video.
    bRollClips = claimedIds
      .slice(0, CLIP_SUPPLY_TARGET)
      .map((assetId, idx) => ({
        assetId,
        order: idx,
        clipType: 'bRoll',
      }));
    matchedClipCount = bRollClips.length;

    // TOP UP TO THE SCENE COUNT. Removing the render-time cycling stopped a
    // clip being REPLAYED, but it could not stop it being REUSED: templates
    // schedule one scene per copy line, so 2 matched clips over 5 scenes still
    // puts each clip on screen two or three times. Measured on a real batch —
    // 5 scenes / 2 clips, 5 / 3, 3 / 2. With two clips and five scenes,
    // repetition is arithmetic, not a bug in the arranger.
    //
    // So hand the renderer as many DISTINCT clips as it has scenes.
    // `selectStockBRoll` already walks the ladder — the service's own matched
    // clips first, then the generic/ambient pool, deduped — so this asks it for
    // the full count and keeps whatever is new. Ambient in the mix is
    // deliberate and owner-approved: a neutral clinic shot is honest, and it
    // beats the same needle three times.
    if (allowStockFootage && bRollClips.length < CLIP_SUPPLY_TARGET) {
      const topUp = await selectStockBRoll(db, {
        organizationId,
        serviceId: serviceRow.id,
        uploadedById: createdById,
        count: CLIP_SUPPLY_TARGET,
      });
      if (topUp.success) {
        const have = new Set(bRollClips.map((c) => c.assetId));
        for (const clip of topUp.data) {
          if (bRollClips.length >= CLIP_SUPPLY_TARGET) break;
          if (have.has(clip.assetId)) continue;
          have.add(clip.assetId);
          bRollClips.push({
            assetId: clip.assetId,
            order: bRollClips.length,
            clipType: 'bRoll',
          });
        }
      }
      toppedUpClipCount = bRollClips.length - matchedClipCount;
    }

    // Not a failure — a measurement. "This video wanted 4 and got 2" is the
    // signal that says where footage is thin, and it is the number that would
    // have surfaced the 2-clip pools on day one instead of via a customer.
    // After the top-up this should be 0; anything else means the ambient pool
    // is thin too, which is a different and more urgent problem.
    clipShortfall = Math.max(0, CLIP_SUPPLY_TARGET - bRollClips.length);

    const usedOwn = claimedIds.some((id) => ownSet.has(id));
    const usedStock = claimedIds.some((id) => !ownSet.has(id));
    footageSource =
      usedOwn && usedStock ? 'mixed' : usedOwn ? 'service-own' : 'stock';
  } else {
    // Nothing claimable. Either the service has no media and no matched stock,
    // or every candidate failed the quality floor. The direct stock selector
    // stays as a last resort so an org whose pool was never primed (or whose
    // priming failed) still gets a video rather than a hole in the batch.
    if (!allowStockFootage) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          `No transcode-ready video footage for ${tpl.id} (service ${serviceRow.name})`
        )
      );
    }
    const stockResult = await selectStockBRoll(db, {
      organizationId,
      serviceId: serviceRow.id,
      uploadedById: createdById,
      count: CLIP_SUPPLY_TARGET,
    });
    if (!stockResult.success || stockResult.data.length === 0) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          `No video footage (uploaded or stock) for ${tpl.id} (service ${serviceRow.name})`
        )
      );
    }
    bRollClips = stockResult.data;
    footageSource = 'stock';
  }

  // NOT ENOUGH SUITABLE FOOTAGE. Logged as its own line rather than left to be
  // inferred from two numbers in a debug payload: this is the owner-actionable
  // fact behind "why does my video keep showing the same clip", and it is what
  // the acquisition list (ENG-670) is built from. `matched` is what the service
  // genuinely had; `toppedUp` is how many neutral clinic shots were needed to
  // reach the scene count.
  if (matchedClipCount > 0 && matchedClipCount < CLIP_SUPPLY_TARGET) {
    logger.warn('Not enough suitable footage for this service', {
      organizationId,
      serviceId: serviceRow.id,
      serviceName: serviceRow.name,
      templateId: tpl.id,
      variationId,
      wanted: CLIP_SUPPLY_TARGET,
      matched: matchedClipCount,
      toppedUpFromStock: toppedUpClipCount,
      stillShort: clipShortfall,
    });
  }

  // THE INVARIANT, enforced once for every branch above rather than trusted in
  // each — including the reuse branch, which replays a PREVIOUS render's list
  // verbatim and so carries pre-fix duplicates into every regeneration.
  const deduped = dedupeBRollClips(bRollClips);
  if (deduped.length !== bRollClips.length) {
    logger.warn('Dropped repeated b-roll clips', {
      organizationId,
      serviceId: serviceRow.id,
      before: bRollClips.length,
      after: deduped.length,
    });
  }
  bRollClips = deduped;

  // The owner-actionable fact, separate from the render's own telemetry: this
  // service has nothing of its own, so whatever went into the video came from
  // the curated bank and can only ever be generically right.
  reportFootageGap({
    organizationId,
    serviceId: serviceRow.id,
    serviceName: serviceRow.name,
    ownClipCount: ownVideoIds.length,
    stockPoolSize: poolSize,
    excludedForQuality,
    selector: 'plan-video-detail',
  });

  logger.info('Resolved video b-roll', {
    organizationId,
    serviceId: serviceRow.id,
    serviceName: serviceRow.name,
    batchId,
    templateId: tpl.id,
    variationId,
    footageSource,
    // How much choice the service actually had of its OWN media. 1 means every
    // video about this treatment would repeat without stock in the pool.
    ownClipCount: ownVideoIds.length,
    // The whole pool, own + stock, after the quality floor.
    poolSize,
    // Media the service HAS but that the floor rejected. A high number here
    // with a low poolSize is a "ask the owner for better footage" signal, not
    // a reason to loosen the threshold.
    excludedForQuality,
    recommendedClipCount: variation.recommendedClipCount,
    clipShortfall,
    matchedClipCount,
    toppedUpClipCount,
    clipCount: bRollClips.length,
  });

  // Music: first track on the template, prefixed with CDN_URL.
  const musicTrack = tpl.musicTracks?.[0];
  const musicUrl =
    musicTrack && cdnUrl ? `${cdnUrl}${musicTrack.path}` : undefined;

  const draftConfig: VideoDraftConfig = {
    narrationType: 'text_only',
    bRollClips,
    captions: {
      enabled: false,
      position: 'bottom',
      fontFamily: 'Inter',
      fontSize: 36,
      textColor: '#FFFFFF',
      highlightColor: '#FFFFFF',
      backgroundColor: '#000000',
      showBackground: false,
    },
    musicVolume: 0.18,
    musicTrackId: musicTrack?.id,
    musicUrl,
    orientation: 'portrait',
    ...organicCopyToConfigBlock(copy),
  };

  // ── 6. Create the draft video row ─────────────────────────────────────
  const createResult = await createVideo(db, {
    title: deriveOrganicTitle(copy, tpl, periodMonth),
    templateId: tpl.id,
    variationId,
    draftConfig,
    organizationId,
    createdById,
    serviceId: serviceRow.id,
    usageType: 'organic',
  });
  if (!createResult.success) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        `createVideo failed for ${tpl.id}: ${createResult.error.code}`
      )
    );
  }
  const videoId = createResult.data.id;

  // Provenance: one row per footage decision, keyed to the video the customer
  // actually sees, so "this video shows the wrong treatment" is a lookup.
  // Best-effort — a diagnostic write must never fail a planned video.
  await recordProvenanceSafe(db, {
    organizationId,
    subjectType: 'video',
    subjectId: videoId,
    batchId,
    serviceId: serviceRow.id,
    // The first clip is the one the viewer sees; the rest are in `detail`.
    // Recorded unconditionally — a stock opener is just as much a footage
    // decision as an own one, and leaving it null was why "which clip did this
    // video actually open on?" had no answer whenever stock was involved.
    chosenAssetId: bRollClips[0]?.assetId,
    // Classified per CLIP rather than per video, so a mixed video reports what
    // the viewer actually sees first.
    mediaSource:
      bRollClips[0] && ownSet.has(bRollClips[0].assetId)
        ? 'service-video-thumbnail'
        : 'stock',
    // Everything that competed for the slot, own and stock alike.
    candidatesConsidered: claimedIds.length > 0 ? claimedIds : undefined,
    templateSlug: variationId,
    detail: {
      templateId: tpl.id,
      footageSource,
      ownClipCount: ownVideoIds.length,
      poolSize,
      excludedForQuality,
      recommendedClipCount: variation.recommendedClipCount,
      clipShortfall,
      matchedClipCount,
      toppedUpClipCount,
      clipAssetIds: bRollClips.map((c) => c.assetId),
    },
  });

  // ── 7. Insert the slot and its cut ────────────────────────────────────
  //
  // A regenerate does NOT land here as a new slot any more: it appends an
  // attempt to the slot it was asked about and moves that slot's pointer, so
  // the post keeps its id, its decision, its schedule and its conversation.
  // Only a first generation creates the slot.
  const itemId = regeneration?.slotId ?? randomUUID();
  const attemptId = randomUUID();
  try {
    await db.transaction(async (trx) => {
      if (!regeneration) {
        await trx.insert(contentItem).values({
          id: itemId,
          organizationId,
          batchId,
          source: 'monthly_batch',
          kind: 'video',
          position,
          reviewStatus: 'pending',
          scheduledAt,
          targetPageIds,
          videoIdea: idea,
        });
      }

      await trx.insert(contentAttempt).values({
        id: attemptId,
        organizationId,
        slotId: itemId,
        batchId,
        attemptNumber: regeneration?.attemptNumber ?? 0,
        videoId,
        caption,
        regenerationReason: regeneration?.refinementInstruction ?? null,
      });

      // Point the slot at the new cut, and — on a re-roll — record the idea it
      // was told and the spend. `videoIdea` moves because a regenerate re-rolls
      // the idea, and the slot is where "what this post is about" lives.
      await trx
        .update(contentItem)
        .set({
          currentAttemptId: attemptId,
          ...(regeneration
            ? {
                regenerationCount: regeneration.regenerationCount,
                videoIdea: idea,
                // The note has been spent on this re-roll; leaving it set would
                // re-offer a regenerate the owner already took.
                pendingRegenerate: null,
              }
            : {}),
        })
        .where(eq(contentItem.id, itemId));
    });
  } catch (error) {
    logError('videos.planVideoDetail.insertBatchItem', error, {
      feature: 'videos',
      extra: { batchId, videoId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to insert content_batch_item row'
      )
    );
  }

  // ── 8. Queue the render ───────────────────────────────────────────────
  //
  // We've already taken the batch-item write — if queueing fails the user
  // can retry from the review UI. The render outcome is decoupled from
  // this service's success.
  const queueResult = await queueVideoExport(db, {
    id: videoId,
    allowStockFootage,
  });
  if (!queueResult.success) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        `queueVideoExport failed for ${tpl.id}: ${queueResult.error.message}`
      )
    );
  }

  return ok({ itemId, videoId });
};

export const planVideoDetail = (
  db: DbConnection,
  input: PlanVideoDetailInput
) =>
  trackedResult(
    'videos.planVideoDetail',
    () => planVideoDetailImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        targetServiceId: input.targetServiceId,
        batchId: input.batchId,
        position: input.position,
      },
    }
  );

export type PlanVideoDetailResult = Awaited<ReturnType<typeof planVideoDetail>>;

// ─── Helpers (copied verbatim from the legacy seedSlot) ──────────────────

function deriveOrganicTitle(
  copy: GeneratedOrganicCopy,
  tpl: ContentIdeaTemplate,
  periodMonth: string
): string {
  switch (copy.kind) {
    case 'caption-tease':
      return (
        truncateTitle(copy.config.headline) ||
        `Organic ${periodMonth} — ${tpl.title}`
      );
    case 'fade-benefits':
      return (
        truncateTitle(copy.config.lines[0]) ||
        `Organic ${periodMonth} — ${tpl.title}`
      );
    case 'highlight-caption':
      return (
        truncateTitle(copy.config.lines[0]) ||
        `Organic ${periodMonth} — ${tpl.title}`
      );
    case 'curiosity-hook':
      return (
        truncateTitle(copy.config.question) ||
        `Organic ${periodMonth} — ${tpl.title}`
      );
    case 'aesthetic-line':
      return (
        truncateTitle(copy.config.text) ||
        `Organic ${periodMonth} — ${tpl.title}`
      );
    case 'numbered-list':
      return (
        truncateTitle(copy.config.title) ||
        `Organic ${periodMonth} — ${tpl.title}`
      );
    case 'ins-outs':
      return (
        truncateTitle(copy.config.title) ||
        `Organic ${periodMonth} — ${tpl.title}`
      );
    case 'question-cta':
      return (
        truncateTitle(copy.config.question) ||
        `Organic ${periodMonth} — ${tpl.title}`
      );
    case 'improves':
      return `${copy.config.serviceName} improves`;
    case 'step-timer':
      return (
        truncateTitle(copy.config.title) ||
        `Organic ${periodMonth} — ${tpl.title}`
      );
    case 'time-progress':
      return (
        truncateTitle(copy.config.caption) ||
        `Organic ${periodMonth} — ${tpl.title}`
      );
    case 'poll':
      return (
        truncateTitle(copy.config.question) ||
        `Organic ${periodMonth} — ${tpl.title}`
      );
    case 'myth-fact':
      return (
        truncateTitle(copy.config.pairs[0]?.myth ?? '') ||
        `Organic ${periodMonth} — ${tpl.title}`
      );
    case 'versus':
      return `${copy.config.treatmentA} vs ${copy.config.treatmentB}`;
    case 'price-reveal':
      return (
        truncateTitle(copy.config.hook) ||
        `Organic ${periodMonth} — ${tpl.title}`
      );
    case 'client-question':
      return (
        truncateTitle(copy.config.question) ||
        `Organic ${periodMonth} — ${tpl.title}`
      );
    case 'come-with-me':
      return (
        truncateTitle(copy.config.title) ||
        `Organic ${periodMonth} — ${tpl.title}`
      );
  }
}

function truncateTitle(s: string, max = 80): string {
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}
