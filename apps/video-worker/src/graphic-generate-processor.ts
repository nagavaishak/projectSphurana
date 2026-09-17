/**
 * Graphic Generate Processor (branded-graphic / nano-banana engine)
 *
 * Consumes the `graphic-generate` queue. Generates each graphic from the org's
 * real service media + brand corpus (Gemini image model), uploads the PNG(s)
 * to S3, writes the graphic row's `outputs[]`, and flips status to `'ready'`.
 *
 *   plan-and-render (socials path): { serviceId, kind, category, topicSummary }
 *   render-only     (bulk + regenerate path): { serviceId, topicSummary, kind }
 *
 * Both modes are the same engine — a single AI graphic, or a coherent
 * orchestrated carousel. On any failure the worker flips the graphic row to
 * `status='failed'` so the frontend polling loop terminates.
 */

import { randomUUID } from 'node:crypto';
import {
  type GraphicOutput,
  brandMediaEmbedding,
  db,
  graphic,
  organization,
  withDbRetry,
  withSystemScope,
} from '@borradh-workspace/database';
import { queueClaireWhatsappOutbound } from '@borradh-workspace/features/assistant';
import { settleBatchForAsset } from '@borradh-workspace/features/content-batches';
import { recordProvenanceSafe } from '@borradh-workspace/features/content-provenance';
import {
  GRAPHIC_GENERATE_QUEUE,
  type GraphicGenerateJobPayload,
  type GraphicGenerationErrorCode,
  GraphicGenerationErrorCodes,
  type GraphicGenerationFailureDetails,
  classifyGraphicGenerationFailure,
  moveToGraphicGenerateDLQ,
} from '@borradh-workspace/features/graphics';
import {
  OFF_DECK_GROUND_DISTANCE,
  buildBrandCorpus,
  colourDistance,
  gateInspirationCandidates,
  generateTemplatedSingle,
  inspectGraphic,
  judgeLogo,
  logoCorrection,
  orchestrateCarousel,
  readGroundColour,
  regenerateCarouselSlide,
  runWithGeminiImageAdmissionBudget,
  selectSingleTemplateSlug,
} from '@borradh-workspace/features/image-generation';
import {
  type Logger,
  createLogger,
  logError,
} from '@borradh-workspace/observability';
import {
  getBullMqPrefix,
  getRedis,
  isTransientRedisError,
} from '@borradh-workspace/redis';
import {
  getOrgAssetsBucket,
  getPresignedDownloadUrl,
  getSignedCdnUrl,
  isCdnEnabled,
  upload,
} from '@borradh-workspace/storage';
import { type Job, Worker } from 'bullmq';
import { and, eq, isNotNull } from 'drizzle-orm';

const GRAPHIC_GENERATE_CONCURRENCY = Number.parseInt(
  process.env.GRAPHIC_GENERATE_CONCURRENCY || '2',
  10
);

/**
 * Queue-level backpressure for graphic jobs. Gemini quota itself is enforced
 * by the shared request-level Redis admission control in `callGeminiImage`:
 * a carousel can fan out into several image requests, so jobs/min alone is
 * not a valid provider-quota limiter.
 */
const GRAPHIC_GENERATE_RATE_PER_MIN = Number(
  process.env.GRAPHIC_GENERATE_RATE_PER_MIN ?? 20
);

/**
 * Total time ONE job may spend queued behind the shared Gemini admission
 * limiter, across every image it renders.
 *
 * The limiter's own ceiling is per request, and a carousel fans out into up to
 * seven of them — unbudgeted, a saturated limiter could park a single job for
 * ~14 minutes, past this worker's 600s `lockDuration`, holding a concurrency
 * slot while doing no work. Well inside the lock, and what remains of it is
 * left for the renders themselves; jobs refused inside this budget come back
 * through the queue's own rate-shaped retry.
 */
const GRAPHIC_ADMISSION_BUDGET_MS = Number(
  process.env.GRAPHIC_ADMISSION_BUDGET_MS ?? 240_000
);

const BRANDED_GRAPHIC_MODEL =
  process.env.BRANDED_GRAPHIC_MODEL || 'gemini-3-pro-image';

/**
 * How the pre-publish quality gate behaves.
 *
 *   enforce — inspect, and re-render once on a blocker (default)
 *   shadow  — inspect and log, change nothing. Use this to measure the gate's
 *             own false-positive rate on real traffic before letting it spend.
 *   off     — do not inspect at all
 *
 * `shadow` exists because the number that decides whether this is worth running
 * is not how many defects it finds but how many CLEAN graphics it wrongly fails.
 */
const GRAPHIC_QA_MODE = (process.env.GRAPHIC_QA_MODE ?? 'enforce') as
  | 'enforce'
  | 'shadow'
  | 'off';

/**
 * Initialised eagerly, not left undefined until `createGraphicGenerateWorker`
 * assigns it. Every helper in this file calls `log.*`, so any entry point that
 * is not the worker factory — a replay harness, a test, a future direct
 * invocation — crashed on `Cannot read properties of undefined (reading
 * 'info')` before doing any work. The factory still re-assigns it; this only
 * removes the window where it does not exist.
 */
let log: Logger = createLogger('graphic-generate');

/**
 * Error thrown when a feature-service `Result` fails inside a job, carrying
 * the FeatureError code so the worker catch can distinguish retryable
 * RATE_LIMITED failures from terminal ones.
 */
class GraphicJobError extends Error {
  constructor(
    message: string,
    readonly featureCode?: string,
    readonly publicCode?: GraphicGenerationErrorCode,
    readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'GraphicJobError';
  }
}

/**
 * Gemini's 5xxs and transport failures are transient provider incidents, just
 * like 429s. `callGeminiImage` performs a short in-call retry first, then
 * returns EXTERNAL_SERVICE_ERROR so this worker can use the queue's longer,
 * rate-shaped retry window. Keep the predicate narrowly typed: database,
 * validation, upload, and programming failures must still fail immediately.
 */
function isRetryableImageProviderError(error: unknown): boolean {
  return (
    error instanceof GraphicJobError &&
    (error.featureCode === 'RATE_LIMITED' ||
      error.featureCode === 'EXTERNAL_SERVICE_ERROR' ||
      error.featureCode === 'TIMEOUT')
  );
}

/**
 * A terminal model refusal — the image model returned no image after its own
 * retries (`no_image_part`) or blocked the request on content safety
 * (`blocked: OTHER`). These are expected model outcomes, not system faults, so
 * they must NOT go to Sentry via `logError` (they were the #2 Sentry noise
 * source). We still mark the graphic failed and notify the user, but log at
 * warn level so they don't page anyone.
 */
function isModelRefusalError(error: unknown): boolean {
  return (
    error instanceof GraphicJobError && error.featureCode === 'AI_MODEL_REFUSED'
  );
}

/**
 * Some Gemini 429s are transient quota pressure, but billing exhaustion is
 * permanent until an operator changes the project. The public failure
 * classifier owns the provider-message detection so its stable error code is
 * the single source of truth for retry decisions as well as user messaging.
 */
function isPermanentRateLimitFailure(
  failure: GraphicGenerationFailureDetails
): boolean {
  return failure.code === GraphicGenerationErrorCodes.MODEL_BILLING_EXHAUSTED;
}

/**
 * Terminal model outcomes and provider billing caps are expected operational
 * states, not application defects. They must be visible in structured logs
 * and in the graphic's stable error code, but must not create Sentry issues.
 */
function isExpectedImageProviderFailure(
  error: unknown,
  failure: GraphicGenerationFailureDetails
): boolean {
  return isModelRefusalError(error) || isPermanentRateLimitFailure(failure);
}

/** Convert internal/provider failures into stable codes safe to show users. */
function classifyGraphicFailure(
  error: unknown
): GraphicGenerationFailureDetails {
  const providerCode =
    error instanceof GraphicJobError ? error.featureCode : undefined;
  return classifyGraphicGenerationFailure({
    message: error instanceof Error ? error.message : String(error),
    providerCode,
    publicCode: error instanceof GraphicJobError ? error.publicCode : undefined,
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Build the S3 key for a per-slide render. One key per slide of the
 * graphic; carousels lay out as `${orgId}/graphics/${graphicId}/0.png`,
 * `.../1.png`, etc. The `${graphicId}` prefix scopes deletes to the
 * graphic, mirroring the delete-graphic cleanup pattern.
 */
function buildKey(
  organizationId: string,
  graphicId: string,
  slideOrder: number
): string {
  return `${organizationId}/graphics/${graphicId}/${slideOrder}.png`;
}

async function uploadPng(
  organizationId: string,
  graphicId: string,
  slideOrder: number,
  buffer: Buffer
): Promise<{ url: string; objectKey: string }> {
  try {
    const bucket = getOrgAssetsBucket();
    const objectKey = buildKey(organizationId, graphicId, slideOrder);
    await upload({
      bucket,
      key: objectKey,
      body: buffer,
      contentType: 'image/png',
    });
    // CDN-signed URL when CloudFront is in front of the bucket; otherwise
    // fall back to a presigned download URL so cookie-less consumers (the
    // admin preview tiles) can fetch.
    const url = isCdnEnabled()
      ? getSignedCdnUrl(objectKey)
      : await getPresignedDownloadUrl({ bucket, key: objectKey });
    return { url, objectKey };
  } catch (error) {
    throw new GraphicJobError(
      `Graphic output upload failed for slide ${slideOrder}`,
      undefined,
      GraphicGenerationErrorCodes.OUTPUT_UPLOAD_FAILED,
      error
    );
  }
}

interface RenderedSlide {
  slideOrder: number;
  width: number;
  height: number;
  url: string;
  objectKey: string;
  slideId: string;
}

/** The org's logo bytes, for the gate's mark comparison. Never throws. */
async function loadBrandLogo(
  organizationId: string
): Promise<Buffer | undefined> {
  try {
    const org = await withSystemScope(
      (conn) =>
        conn.query.organization.findFirst({
          where: eq(organization.id, organizationId),
          columns: { logo: true },
        }),
      { db }
    );
    if (!org?.logo) return undefined;
    const res = await fetch(org.logo, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return undefined;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return undefined;
  }
}

/** Re-render one slide with a correction, or null when the path cannot retry. */
type SlideRerender = (
  slideOrder: number,
  correction: string,
  priorImageUrl: string,
  /** The photograph the slide already used — pin it, do not re-resolve. */
  consumedAssetId?: string,
  /** The words the slide already carries — pin them, do not re-plan them. */
  copy?: { heading: string; body: string }
) => Promise<{ png: Buffer; width: number; height: number } | null>;

/**
 * Inspect finished slides and, in `enforce` mode, re-render the broken ones.
 *
 * Runs AFTER upload and BEFORE the row is flipped to `ready`. Uploading first is
 * deliberate: the retry needs a `priorImageUrl` to amend from, the S3 key is
 * deterministic so a replacement overwrites in place, and nothing reads the
 * outputs until commit — so a rejected render is never visible.
 *
 * ONE retry, and the retry must CHANGE something. Re-rolling the same request
 * re-samples the same distribution; the model that duplicated a headline once
 * will duplicate it again at about the same rate. Feeding the defect back as a
 * correction is what makes the second attempt different.
 *
 * FAILS OPEN throughout. A gate that cannot run has no opinion, and an
 * observability layer must never be able to block the pipeline.
 */
async function runQualityGate(args: {
  graphicId: string;
  organizationId: string;
  serviceId: string;
  allowAiImages: boolean;
  slides: {
    slideOrder: number;
    png: Buffer;
    url: string;
    /** Pinned so a correction re-renders the SAME photograph. */
    consumedAssetId?: string;
    /** Pinned so a correction cannot re-plan the slide's words. */
    copy?: { heading: string; body: string };
  }[];
  rerender: SlideRerender | null;
}): Promise<Map<number, { png: Buffer; width: number; height: number }>> {
  const replacements = new Map<
    number,
    { png: Buffer; width: number; height: number }
  >();
  if (GRAPHIC_QA_MODE === 'off') return replacements;

  // The gate cannot recognise a RE-TYPESET mark without something to compare
  // against — two renders from the same template and inputs produced the real
  // script lockup on one and the business name in plain capitals on the other,
  // and only a side-by-side tells them apart. Best-effort: no logo just means
  // the gate keeps its other checks.
  const brandLogo = await loadBrandLogo(args.organizationId);

  /**
   * The deck's own ground, read from the cover, so slides can be checked
   * against each other.
   *
   * Every input that should pin a slide's colour — the palette swatch, the deck
   * anchor, the design model — is present and correct in the slides that go
   * wrong; that was verified from the request manifest. So the residual failure
   * is SAMPLING, and sampling is caught by looking at the output rather than by
   * adding another input.
   */
  const coverGround =
    args.slides.length > 1
      ? await readGroundColour(
          (args.slides.find((s) => s.slideOrder === 0) ?? args.slides[0]).png
        )
      : null;

  for (const slide of args.slides) {
    /**
     * REPORTED, NOT RE-ROLLED — deliberately, for now.
     *
     * The corrective path re-renders a slide as an AMENDMENT OF ITSELF: the
     * rejected image goes back in as "the previous version — reproduce its
     * layout, composition, branding and fonts faithfully". For every other
     * defect class that is right. For COLOUR it cannot work, because the thing
     * to be corrected is the very image the re-render is told to reproduce.
     *
     * Fixing it properly means re-running the slide through its ORIGINAL path —
     * deck anchor and palette swatch, no prior image — which lives in
     * `orchestrateCarousel`, not here. Until then this measures the rate in
     * production rather than pretending to fix it. Observed locally at 4 slides
     * in 30 (~13%), singly and at random positions.
     */
    if (coverGround && slide.slideOrder !== 0) {
      const ground = await readGroundColour(slide.png);
      const drift = ground ? colourDistance(ground, coverGround) : 0;
      if (ground && drift > OFF_DECK_GROUND_DISTANCE) {
        log.warn('Slide ground does not match the deck', {
          event: 'content.slide_off_deck_colour',
          graphicId: args.graphicId,
          organizationId: args.organizationId,
          slideOrder: slide.slideOrder,
          coverGround,
          slideGround: ground,
          drift: Math.round(drift),
        });
      }
    }

    // Only the COVER of a deck carries the mark; the rest are deliberately
    // unbranded, so their missing logo is the design, not a defect. Without
    // this the gate flagged 8 of 9 slides in a correctly-built deck and would
    // have re-rolled every one of them.
    const expectLogo = args.slides.length > 1 ? slide.slideOrder === 0 : true;

    const inspection = await inspectGraphic({
      png: slide.png,
      allowAiImages: args.allowAiImages,
      brandLogo,
      expectLogo,
      slideOrder: args.slides.length > 1 ? slide.slideOrder : undefined,
    });
    if (!inspection.success) {
      log.warn('Quality gate could not run — shipping the graphic', {
        graphicId: args.graphicId,
        slideOrder: slide.slideOrder,
        error: inspection.error.message,
      });
      continue;
    }
    // A SECOND, dedicated judge for the mark.
    //
    // `inspectGraphic` carries a re-typeset rule and still missed a plainly
    // re-typeset logo — business name in an ordinary serif, leaf emblem gone —
    // while reporting a lesser defect on the same image. A ten-item checklist
    // tuned conservative loses the rare specific judgement to the common
    // general one, so the comparison gets its own call. Only where a mark is
    // expected, and only when we have a real logo to compare against.
    const logoDefects: string[] = [];
    if (expectLogo && brandLogo) {
      const judgement = await judgeLogo({
        png: slide.png,
        brandLogo,
        slideOrder: args.slides.length > 1 ? slide.slideOrder : undefined,
      });
      if (judgement.success && judgement.data.isDefect) {
        const correction = logoCorrection(judgement.data);
        if (correction) logoDefects.push(correction);
        log.warn('Logo judge rejected the mark', {
          graphicId: args.graphicId,
          organizationId: args.organizationId,
          slideOrder: slide.slideOrder,
          verdict: judgement.data.verdict,
          note: judgement.data.note,
          localisation: judgement.data.localisation,
        });
      }
    }

    if (inspection.data.defects.length === 0 && logoDefects.length === 0)
      continue;

    log.warn('Quality gate found defects', {
      graphicId: args.graphicId,
      organizationId: args.organizationId,
      slideOrder: slide.slideOrder,
      mode: GRAPHIC_QA_MODE,
      blockers: inspection.data.blockers.length,
      warnings:
        inspection.data.defects.length - inspection.data.blockers.length,
      kinds: inspection.data.defects.map((d) => d.kind),
      logoDefects: logoDefects.length,
      details: inspection.data.defects.map((d) => d.detail),
    });

    // A wrong mark is always worth a re-roll: it is the defect owners report,
    // and the one the whole ENG-542 investigation was about.
    const corrections = [
      ...inspection.data.blockers.map((d) => d.detail),
      ...logoDefects,
    ];

    if (
      GRAPHIC_QA_MODE !== 'enforce' ||
      !args.rerender ||
      corrections.length === 0
    ) {
      continue;
    }

    const correction = `The previous version of this image has ${corrections.join(
      ' Also: '
    )} Fix that specifically and change nothing else.`;

    /**
     * THE GATE'S VERDICT IS PROVENANCE, NOT JUST A LOG LINE.
     *
     * A re-rendered slide is indistinguishable from a first-render slide once
     * it has shipped, and that cost a day: a slide that was plainly not built
     * the way its neighbours were had in fact been rejected here and rebuilt by
     * a different call, and the only record was a log line nobody kept.
     *
     * Written BEFORE the re-render so the intent survives even if the
     * correction throws, and best-effort like every other provenance write —
     * an observability layer must never be able to fail a render.
     */
    await recordProvenanceSafe(db, {
      organizationId: args.organizationId,
      subjectType: 'graphic',
      subjectId: args.graphicId,
      serviceId: args.serviceId,
      mediaSource: 'none',
      logoOutcome: 'not-applicable',
      detail: {
        operation: 'quality-gate',
        slideIndex: slide.slideOrder,
        blockers: inspection.data.blockers.map((d) => d.kind),
        blockerDetail: inspection.data.blockers.map((d) => d.detail),
        correction,
        // Slides the gate cannot act on are skipped before this point, so a
        // row here always means a correction was attempted.
        action: 're-render',
      },
    });

    try {
      let replacement = await args.rerender(
        slide.slideOrder,
        correction,
        slide.url,
        slide.consumedAssetId,
        slide.copy
      );
      if (replacement) {
        // RE-INSPECT. The retry was committed unconditionally, so a correction
        // that did not correct shipped and the gate reported success — observed
        // live: a slide re-rendered to fix a duplicated word ("we e will") came
        // back still carrying it, overwrote the original, and the deck went to
        // `ready`. "We re-rendered it" is not evidence the defect is gone.
        //
        // Fails open like everything else here: if the second look cannot run we
        // keep the replacement, because it was produced from a correction and is
        // no worse a bet than the original.
        const recheck = await inspectGraphic({
          png: replacement.png,
          allowAiImages: args.allowAiImages,
          brandLogo,
          expectLogo,
          slideOrder: args.slides.length > 1 ? slide.slideOrder : undefined,
        });
        const survived =
          recheck.success && recheck.data.blockers.length > 0
            ? recheck.data.blockers.map((d) => d.kind)
            : [];
        if (survived.length > 0) {
          /**
           * ONE MORE ATTEMPT, AND IT MUST NAME WHAT SURVIVED.
           *
           * Measured over one batch: 3 of 18 corrections failed. Two of the
           * three fixed the defect they were given and introduced a DIFFERENT
           * one (`fabricated-before-after` -> `duplicate-text`), because the
           * correction re-generates rather than edits — so the second attempt
           * has to describe the NEW defect, not repeat the original complaint.
           *
           * Bounded at two. A third costs another paid image call for a
           * distribution that has now missed twice, and the owner reviews
           * everything before it publishes.
           */
          await recordProvenanceSafe(db, {
            organizationId: args.organizationId,
            subjectType: 'graphic',
            subjectId: args.graphicId,
            serviceId: args.serviceId,
            mediaSource: 'none',
            logoOutcome: 'not-applicable',
            detail: {
              operation: 'quality-gate-outcome',
              slideIndex: slide.slideOrder,
              // The re-render was committed unconditionally once, so a
              // correction that did not correct shipped while the gate reported
              // success. What survived is the part worth querying.
              survived,
            },
          });
          log.warn('Defect survived the corrective re-render', {
            graphicId: args.graphicId,
            organizationId: args.organizationId,
            slideOrder: slide.slideOrder,
            before: inspection.data.blockers.map((d) => d.kind),
            after: survived,
          });
          const second = await args.rerender(
            slide.slideOrder,
            `The previous version of this image has ${recheck.success ? recheck.data.blockers.map((d) => d.detail).join(' Also: ') : survived.join(', ')} Fix that specifically and change nothing else.`,
            slide.url,
            slide.consumedAssetId,
            slide.copy
          );
          if (second) {
            const third = await inspectGraphic({
              png: second.png,
              allowAiImages: args.allowAiImages,
              brandLogo,
              expectLogo,
              slideOrder: args.slides.length > 1 ? slide.slideOrder : undefined,
            });
            const stillBroken =
              third.success && third.data.blockers.length > 0
                ? third.data.blockers.map((d) => d.kind)
                : [];
            log.warn('Second corrective attempt', {
              graphicId: args.graphicId,
              slideOrder: slide.slideOrder,
              cleared: stillBroken.length === 0,
              remaining: stillBroken,
            });
            // Keep whichever attempt inspects cleaner. A second re-roll that is
            // still broken is not automatically better than the first.
            if (stillBroken.length === 0) replacement = second;
          }
        }
        replacements.set(slide.slideOrder, replacement);
        log.info('Re-rendered a slide the quality gate rejected', {
          graphicId: args.graphicId,
          slideOrder: slide.slideOrder,
          defectCleared: survived.length === 0,
        });
      }
    } catch (error) {
      // A failed correction ships the original. It has known defects, but a
      // missing graphic in a batch is worse than a flawed one, and the owner
      // reviews everything before it publishes.
      log.warn('Quality-gate re-render failed — shipping the original', {
        graphicId: args.graphicId,
        slideOrder: slide.slideOrder,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return replacements;
}

/** Patch the final `outputs[]` (+ optional pinned templateSlug) onto the row
 *  and flip it to `ready`. Retries transient connection blips so a rendered
 *  graphic is never stranded in `rendering`. */
async function writeGraphicOutputs(
  graphicId: string,
  outputs: GraphicOutput[],
  templateSlug?: string,
  renderedCopy?: string,
  title?: string
): Promise<void> {
  try {
    await withDbRetry(
      () =>
        withSystemScope(
          (conn) =>
            conn
              .update(graphic)
              .set({
                status: 'ready',
                outputs,
                errorCode: null,
                errorMessage: null,
                updatedAt: new Date(),
                // The row was inserted with a placeholder title —
                // `Generating: <service name>` — and nothing ever replaced it,
                // so every finished graphic still announced itself as
                // in-progress AND every graphic for the same service was
                // titled identically. That is not cosmetic: it is the list
                // Claire matches against when an owner says "change the one
                // that says X", and three identical rows cannot be told apart.
                ...(title ? { title } : {}),
                ...(templateSlug ? { templateSlug } : {}),
                // Persist the copy so the NEXT regenerate can amend it. Copy
                // is written fresh by Claude on every render, so without this
                // "change the headline" reissues the body and CTA too.
                ...(renderedCopy ? { renderedCopy } : {}),
              })
              .where(eq(graphic.id, graphicId)),
          { db }
        ),
      { retries: 5, minDelayMs: 300, maxDelayMs: 3000 }
    );
  } catch (error) {
    throw new GraphicJobError(
      'Graphic result could not be saved after database retries',
      undefined,
      GraphicGenerationErrorCodes.RESULT_SAVE_FAILED,
      error
    );
  }
  // Outside the try: settling is bookkeeping about a render that HAS landed,
  // and a problem there must never be reported as "the result could not be
  // saved". It is also why it runs after the write commits — the settle reads
  // this row back to decide whether anything is still outstanding.
  await settleOwningBatch(graphicId);
}

/**
 * Build the canonical `outputs[]` payload for a set of rendered slides, and
 * patch it onto the pre-inserted graphic row alongside `status='ready'`. The
 * pinned `templateSlug` is persisted so a later regenerate re-rolls against the
 * same template.
 */
async function commitGraphic(
  graphicId: string,
  rendered: RenderedSlide[],
  templateSlug?: string,
  renderedCopy?: string
): Promise<void> {
  // First line of the copy, trimmed — the headline the owner will recognise.
  // Falls back to leaving the placeholder rather than inventing something.
  const title = renderedCopy
    ? (
        renderedCopy
          .replace(/^Slide 1:\s*/i, '')
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l.length > 0) ?? ''
      )
        .replace(/[*_`#]/g, '')
        .slice(0, 90) || undefined
    : undefined;
  const outputs: GraphicOutput[] = rendered.map((r) => ({
    aspectRatioId: '4:5',
    platform: 'Instagram Feed',
    width: r.width,
    height: r.height,
    url: r.url,
    format: 'png',
    renderedAt: new Date().toISOString(),
    slideId: r.slideId,
    slideOrder: r.slideOrder,
    objectKey: r.objectKey,
    renderedBy: 'server',
    status: 'success',
  }));

  await writeGraphicOutputs(
    graphicId,
    outputs,
    templateSlug,
    renderedCopy,
    title
  );
}

/**
 * A finished render is the last thing that has to happen before a content batch
 * can be reviewed — and until now nothing told the batch. Its status entered
 * `'generating'` at the end of the seed and stayed there for good, so anything
 * server-side wanting to know "is this batch done?" (a proactive Claire, the
 * status readout in settings) had no answer to read. Settle it here, where the
 * render actually ends.
 *
 * Never allowed to disturb the render: a batch that fails to settle is a stale
 * status, while a throw here would strand a graphic the owner is waiting for.
 */
async function settleOwningBatch(graphicId: string): Promise<void> {
  try {
    const result = await withSystemScope(
      (conn) => settleBatchForAsset(conn, { graphicId }),
      { db }
    );
    if (!result.success) {
      logError(
        'video-worker.graphicGenerate.settleBatch',
        new Error(result.error.message),
        { feature: 'video-worker', extra: { graphicId } }
      );
    }
  } catch (error) {
    logError('video-worker.graphicGenerate.settleBatch', error, {
      feature: 'video-worker',
      extra: { graphicId },
    });
  }
}

async function markGraphicFailed(
  graphicId: string,
  failure: GraphicGenerationFailureDetails
): Promise<void> {
  await withDbRetry(
    () =>
      withSystemScope(
        (conn) =>
          conn
            .update(graphic)
            .set({
              status: 'failed',
              errorCode: failure.code,
              errorMessage: failure.userMessage,
              updatedAt: new Date(),
            })
            .where(eq(graphic.id, graphicId)),
        { db }
      ),
    { retries: 5, minDelayMs: 300, maxDelayMs: 3000 }
  ).catch((error) => {
    logError('video-worker.graphicGenerate.markFailed', error, {
      feature: 'video-worker',
      extra: { graphicId, errorCode: failure.code },
    });
  });
  // A failed render is terminal too: the batch is done waiting on this slot,
  // and the owner reviews it as a failure rather than staring at a spinner.
  await settleOwningBatch(graphicId);
}

/**
 * Push the finished graphic image(s) to the owner's WhatsApp conversation.
 * Mirrors `deliverFinishedVideoToWhatsapp` in main.ts: sign the first output
 * URL and enqueue via the generic outbound transport. Images are always small
 * enough for inline media (PNGs are 1-2 MB), so no size probe is needed.
 */
async function deliverFinishedGraphicToWhatsapp(args: {
  organizationId: string;
  userId: string;
  conversationId: string;
  graphicId: string;
}): Promise<void> {
  const { organizationId, userId, conversationId, graphicId } = args;

  const row = await withSystemScope(
    (conn) =>
      conn.query.graphic.findFirst({
        where: eq(graphic.id, graphicId),
        columns: { outputs: true, kind: true },
      }),
    { db }
  );

  const outputs = row?.outputs ?? [];
  if (outputs.length === 0) {
    log.warn('No outputs to deliver for WhatsApp graphic', { graphicId });
    return;
  }

  const messages = await Promise.all(
    outputs
      .slice()
      .sort((a, b) => (a.slideOrder ?? 0) - (b.slideOrder ?? 0))
      .map(async (output, idx) => {
        const key = output.objectKey;
        if (!key) {
          log.warn('Graphic output missing objectKey, skipping', {
            graphicId,
            slideOrder: output.slideOrder,
          });
          return null;
        }
        const signedUrl = isCdnEnabled()
          ? getSignedCdnUrl(key)
          : await getPresignedDownloadUrl({
              bucket: getOrgAssetsBucket(),
              key,
            });
        return {
          kind: 'media' as const,
          mediaType: 'image' as const,
          link: signedUrl,
          caption:
            outputs.length > 1
              ? `Slide ${idx + 1} of ${outputs.length}`
              : "Here's your graphic! 🎨",
        };
      })
  );

  const validMessages = messages.filter(
    (m): m is NonNullable<typeof m> => m != null
  );
  if (validMessages.length === 0) return;

  const res = await queueClaireWhatsappOutbound({
    organizationId,
    userId,
    conversationId,
    messages: validMessages,
    recordAs:
      validMessages.length > 1
        ? `Delivered a ${validMessages.length}-slide carousel graphic.`
        : 'Delivered the finished graphic.',
    dedupeKey: `graphic-ready:${graphicId}`,
  });
  if (!res.success) {
    log.warn('Failed to enqueue Claire WhatsApp graphic delivery', {
      graphicId,
      error: res.error.message,
    });
  }
}

// ─── Branded-graphic (nano-banana) engine ─────────────────────────────────

/**
 * Ensure the org has brand references this generation can actually USE.
 *
 * The bar is not "has rows" — it is "has rows we hold the image bytes for".
 * This function used to gate on the former, and combined with an ingest that
 * never rewrote an existing row, that meant a corpus was built exactly once and
 * then decayed: Meta's signed CDN URLs expire in about a week, and a prod probe
 * found 99.3% of rows no longer resolved. Every one of those orgs was
 * generating with no brand reference while this function reported success.
 *
 * Best-effort — a failure (e.g. no connected page) is logged and we proceed
 * without references (the graphic still renders from real service media + logo
 * + brand colours).
 */
async function ensureBrandCorpus(organizationId: string): Promise<void> {
  try {
    const usable = await withSystemScope(
      (conn) =>
        conn.query.brandMediaEmbedding.findFirst({
          where: and(
            eq(brandMediaEmbedding.organizationId, organizationId),
            isNotNull(brandMediaEmbedding.objectKey)
          ),
          columns: { id: true },
        }),
      { db }
    );
    if (!usable) {
      log.info('No usable brand references — building corpus', {
        organizationId,
      });
      const built = await buildBrandCorpus(db, { organizationId, limit: 80 });
      if (!built.success) {
        log.warn(
          `Brand corpus build skipped (${built.error.code}): ${built.error.message}`
        );
      } else {
        log.info('Brand corpus built', {
          organizationId,
          inserted: built.data.inserted,
          repaired: built.data.repaired,
          pulled: built.data.pulled,
          // Non-zero means posts whose source URL had already expired — those
          // are unrecoverable without the owner reconnecting Meta.
          unpersistable: built.data.unpersistable,
        });
      }
    }

    // Classify whatever is not yet gated. Cheap and incremental — it only
    // touches rows with a durable copy and no verdict — but it has to happen
    // before selection can choose anything, so it runs on the same
    // build-on-first-use path rather than waiting for a separate job.
    const gated = await gateInspirationCandidates(db, { organizationId });
    if (gated.success && gated.data.gated > 0) {
      log.info('Gated inspiration candidates', {
        organizationId,
        gated: gated.data.gated,
        usable: gated.data.usable,
      });
    }
  } catch (error) {
    log.warn(
      `ensureBrandCorpus failed (continuing without references): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function renderBrandedGraphic(args: {
  graphicId: string;
  organizationId: string;
  serviceId: string;
  topic: string;
  kind: 'single' | 'carousel';
  brandPrimaryColor: string;
  allowAiImages: boolean;
  sourceAssetIds?: string[];
  /** Whether the curated stock-image tier may fill slots (default-true upstream). */
  allowStockImages: boolean;
  usageType: 'organic' | 'ad';
  offerId?: string;
  /** Free-text user change request, threaded into copy + image prompt. */
  refinementInstruction?: string;
  /** Previous render URL for refinement-aware regen (single graphics only). */
  priorImageUrl?: string;
  /** Copy currently on the graphic being regenerated — enables a surgical edit. */
  priorCopy?: string;
  /** What is changing: the words, the photography, or everything. */
  regenerationIntent?: 'copy' | 'image' | 'branding' | 'full';
  /** Pinned template slug — reuse it instead of re-selecting on a regenerate. */
  templateSlug?: string;
  /**
   * TARGETED carousel refine: which slides to re-render and what to tell the
   * model about each. One entry is the single-slide re-roll this replaced.
   */
  // Mirrors the queue payload (queue-graphic-generate.schema.ts): `op` selects
  // refine-vs-remove and defaults to 'refine', and `note` is optional because a
  // removal has nothing to say. This declaration predated both and demanded a
  // `note` the sender never had to supply.
  slideInstructions?: {
    slideIndex: number;
    op?: 'refine' | 'remove';
    note?: string;
  }[];
  /**
   * The graphic being edited.
   *
   * With `slideInstructions`, the slides it does NOT name are preserved
   * verbatim. WITHOUT it, this anchors a whole-deck refine: every slide is
   * re-rendered from its OWN prior image rather than the deck being recomposed
   * from the curated inspiration.
   */
  priorGraphicId?: string;
}): Promise<void> {
  await ensureBrandCorpus(args.organizationId);

  // Paid-ad graphics are single-image only (offer + badge + CTA); there are no
  // ad carousels yet, so an ad request always renders a single.
  const effectiveKind = args.usageType === 'ad' ? 'single' : args.kind;

  // ── Single-slide carousel refine: re-render just one slide from its prior
  //    image, splice it into the preserved outputs of the source graphic ──
  if (
    effectiveKind === 'carousel' &&
    args.slideInstructions?.length &&
    args.templateSlug &&
    args.priorGraphicId
  ) {
    await refineCarouselSlides({
      graphicId: args.graphicId,
      organizationId: args.organizationId,
      serviceId: args.serviceId,
      topic: args.topic,
      templateSlug: args.templateSlug,
      slideInstructions: args.slideInstructions,
      priorGraphicId: args.priorGraphicId,
      regenerationIntent: args.regenerationIntent,
      brandPrimaryColor: args.brandPrimaryColor,
      allowAiImages: args.allowAiImages,
      sourceAssetIds: args.sourceAssetIds,
      allowStockImages: args.allowStockImages,
    });
    return;
  }

  // ── Whole-deck carousel refine: amend EVERY slide from its own prior
  //    image, instead of recomposing the deck from scratch ──
  //
  // The single-graphic path has anchored to its prior render for a while; the
  // carousel path never could, because `priorImageUrl` upstream is
  // `outputs[0].url` — slide 1 and nothing else. So "make the headline
  // shorter" on a carousel replanned the copy and re-rendered all five slides
  // from the curated inspiration image, returning a different deck. Roughly
  // 40% of graphics are carousels, so this was the larger half of "editing the
  // graphic doesn't work".
  //
  // Routing through the per-slide refine that already works, rather than
  // teaching `orchestrateCarousel` about prior images, is deliberate: that
  // path is proven, and it keeps "compose a deck" and "amend a deck" as two
  // code paths instead of one path with a mode flag — which is how the
  // amendment inputs got tangled with the composition inputs on the single
  // path in the first place.
  //
  // REQUIRES an instruction and a pinned template. Without an instruction
  // there is nothing to amend and a re-roll is the honest reading of
  // "regenerate"; without a template slug `regenerateCarouselSlide` cannot
  // resolve the slide's layout at all. Both fall through to the re-roll below.
  if (
    effectiveKind === 'carousel' &&
    !args.slideInstructions?.length &&
    args.priorGraphicId &&
    args.templateSlug &&
    args.refinementInstruction?.trim()
  ) {
    const refined = await refineCarouselDeck({
      graphicId: args.graphicId,
      organizationId: args.organizationId,
      serviceId: args.serviceId,
      topic: args.topic,
      templateSlug: args.templateSlug,
      priorGraphicId: args.priorGraphicId,
      regenerationIntent: args.regenerationIntent,
      brandPrimaryColor: args.brandPrimaryColor,
      allowAiImages: args.allowAiImages,
      sourceAssetIds: args.sourceAssetIds,
      allowStockImages: args.allowStockImages,
      refinementInstruction: args.refinementInstruction,
    });
    // `false` means the source had no usable slides to amend — fall through
    // and compose a fresh deck rather than failing the job.
    if (refined) return;
    log.warn('Whole-deck refine had nothing to amend; composing fresh', {
      graphicId: args.graphicId,
      priorGraphicId: args.priorGraphicId,
    });
  }

  // ── Carousel: orchestrate a coherent multi-slide set from a template ──
  if (effectiveKind === 'carousel') {
    // SAY WHY a re-roll is composing from scratch instead of amending.
    //
    // Reaching here WITH a prior graphic means an edit was intended and every
    // refine branch above declined it — the deck is about to be replaced with
    // unrelated content, which is what the owner sees. It used to happen in
    // silence: an instruction stripped upstream (a stale API dropping an
    // unknown field, say) left a payload that looked like a plain re-roll, and
    // nothing anywhere recorded that the edit had gone missing. The only way to
    // find it was to read the job off Redis by hand.
    if (args.priorGraphicId) {
      log.warn('Carousel re-roll composing FRESH — the edit was not applied', {
        graphicId: args.graphicId,
        organizationId: args.organizationId,
        priorGraphicId: args.priorGraphicId,
        // Whichever of these is false is the reason.
        hasSlideInstructions: Boolean(args.slideInstructions?.length),
        hasRefinementInstruction: Boolean(args.refinementInstruction?.trim()),
        hasTemplateSlug: Boolean(args.templateSlug),
        slideInstructionCount: args.slideInstructions?.length ?? 0,
      });
    }
    /**
     * FORWARD THE PIN; DO NOT INVENT ONE.
     *
     * This used to pick a composition template here and log "Selected carousel
     * template" just before handing over — a line that was true about this
     * function and false about the deck, because the orchestrator then
     * superseded the choice with a brief. Anyone reading the logs (or this
     * code) concluded the deck followed the template it names. It did not.
     *
     * Selection belongs where the deck's shape is actually decided, so the
     * orchestrator resolves the brief from the pin, or from the graphic id when
     * there is no pin, and logs what it settled on.
     */
    const templateSlug = args.templateSlug;
    const carousel = await orchestrateCarousel(db, {
      organizationId: args.organizationId,
      serviceId: args.serviceId,
      graphicId: args.graphicId,
      topic: args.topic,
      templateSlug,
      model: BRANDED_GRAPHIC_MODEL,
      brandPrimaryColor: args.brandPrimaryColor,
      allowAiImages: args.allowAiImages,
      sourceAssetIds: args.sourceAssetIds,
      allowStockImages: args.allowStockImages,
      refinementInstruction: args.refinementInstruction,
    });
    if (!carousel.success) {
      throw new GraphicJobError(
        `orchestrateCarousel failed: ${carousel.error.code}: ${carousel.error.message}`,
        carousel.error.code
      );
    }
    log.info('Branded carousel generated', {
      graphicId: args.graphicId,
      organizationId: args.organizationId,
      slideCount: carousel.data.slides.length,
      model: carousel.data.model,
      templateSlug,
    });
    const rendered: RenderedSlide[] = [];
    for (const slide of carousel.data.slides) {
      const { url, objectKey } = await uploadPng(
        args.organizationId,
        args.graphicId,
        slide.slideOrder,
        slide.png
      );
      rendered.push({
        slideOrder: slide.slideOrder,
        width: slide.width,
        height: slide.height,
        url,
        objectKey,
        slideId: randomUUID(),
      });
    }

    const fixes = await runQualityGate({
      graphicId: args.graphicId,
      organizationId: args.organizationId,
      serviceId: args.serviceId,
      allowAiImages: args.allowAiImages,
      slides: carousel.data.slides.map((s) => ({
        slideOrder: s.slideOrder,
        png: s.png,
        url: rendered.find((r) => r.slideOrder === s.slideOrder)?.url ?? '',
        consumedAssetId: s.consumedAssetId,
        copy: s.copy,
      })),
      rerender: async (
        slideOrder,
        correction,
        priorImageUrl,
        consumedAssetId,
        copy
      ) => {
        const fixed = await regenerateCarouselSlide(db, {
          organizationId: args.organizationId,
          serviceId: args.serviceId,
          topic: args.topic,
          templateSlug,
          slideIndex: slideOrder,
          priorImageUrl,
          // PIN THE WORDS, for the same reason the photograph is pinned below.
          // This sent the DECK's topic and no copy, so a correction aimed at a
          // logo could rewrite the slide's text — and did, when the prior image
          // failed to load and the re-render fell back to a full re-roll.
          renderCopy: copy,
          refinementInstruction: correction,
          graphicId: args.graphicId,
          // A defect fix is not a restyle: anchor everything that was right.
          regenerationIntent: 'copy',
          provenanceOperation: 'refine-slide',
          model: BRANDED_GRAPHIC_MODEL,
          brandPrimaryColor: args.brandPrimaryColor,
          allowAiImages: args.allowAiImages,
          // PIN THE PHOTOGRAPH THIS SLIDE ALREADY HAD.
          //
          // Without it the correction re-resolved the slot and took whatever
          // the service pool offered — which was the picture the next slide was
          // showing, so fixing a logo on slide 0 put a duplicate into a deck
          // that had been built without one. A correction changes the defect it
          // was given and nothing else.
          sourceAssetIds: consumedAssetId
            ? [consumedAssetId]
            : args.sourceAssetIds,
          allowStockImages: args.allowStockImages,
        });
        return fixed.success ? fixed.data : null;
      },
    });

    for (const [slideOrder, fixed] of fixes) {
      const { url, objectKey } = await uploadPng(
        args.organizationId,
        args.graphicId,
        slideOrder,
        fixed.png
      );
      const target = rendered.find((r) => r.slideOrder === slideOrder);
      if (target) {
        target.url = url;
        target.objectKey = objectKey;
        target.width = fixed.width;
        target.height = fixed.height;
      }
    }

    await commitGraphic(
      args.graphicId,
      rendered,
      templateSlug,
      carousel.data.renderedCopy
    );
    return;
  }

  // ── Single graphic from a curated single-template ────────────────────
  // Ad requests select from the paid-offer template pool; organic from the
  // social-post pool.
  const singleTemplateSlug =
    args.templateSlug ??
    selectSingleTemplateSlug(args.graphicId, args.usageType);
  log.info('Selected single template', {
    graphicId: args.graphicId,
    organizationId: args.organizationId,
    usageType: args.usageType,
    templateSlug: singleTemplateSlug,
    // Whether the template was pinned (regeneration) or freshly selected —
    // template drift between regenerations was a real bug once.
    pinned: Boolean(args.templateSlug),
  });
  const result = await generateTemplatedSingle(db, {
    organizationId: args.organizationId,
    serviceId: args.serviceId,
    topic: args.topic,
    templateSlug: singleTemplateSlug,
    model: BRANDED_GRAPHIC_MODEL,
    brandPrimaryColor: args.brandPrimaryColor,
    allowAiImages: args.allowAiImages,
    sourceAssetIds: args.sourceAssetIds,
    allowStockImages: args.allowStockImages,
    usageType: args.usageType,
    offerId: args.offerId,
    refinementInstruction: args.refinementInstruction,
    priorImageUrl: args.priorImageUrl,
    graphicId: args.graphicId,
    priorCopy: args.priorCopy,
    regenerationIntent: args.regenerationIntent,
  });
  if (!result.success) {
    throw new GraphicJobError(
      `generateTemplatedSingle failed: ${result.error.code}: ${result.error.message}`,
      result.error.code
    );
  }
  // `usedServiceMedia` is the single most diagnostic field here: false means
  // the model invented the subject imagery rather than using the org's own
  // photo of the treatment.
  log.info('Branded graphic generated', {
    graphicId: args.graphicId,
    organizationId: args.organizationId,
    serviceId: args.serviceId,
    model: result.data.model,
    usedServiceMedia: result.data.usedServiceMedia,
    referenceCount: result.data.referenceCount,
    templateSlug: singleTemplateSlug,
  });

  let { url, objectKey } = await uploadPng(
    args.organizationId,
    args.graphicId,
    0,
    result.data.png
  );
  let { width, height } = result.data;

  const fixes = await runQualityGate({
    graphicId: args.graphicId,
    organizationId: args.organizationId,
    serviceId: args.serviceId,
    allowAiImages: args.allowAiImages,
    slides: [{ slideOrder: 0, png: result.data.png, url }],
    rerender: async (_slideOrder, correction, priorImageUrl) => {
      const fixed = await generateTemplatedSingle(db, {
        organizationId: args.organizationId,
        serviceId: args.serviceId,
        topic: args.topic,
        // Pin the template and the copy so the correction is a repair, not a
        // fresh graphic that happens to be defect-free.
        templateSlug: singleTemplateSlug,
        priorCopy: result.data.renderedCopy,
        priorImageUrl,
        regenerationIntent: 'copy',
        refinementInstruction: correction,
        model: BRANDED_GRAPHIC_MODEL,
        brandPrimaryColor: args.brandPrimaryColor,
        allowAiImages: args.allowAiImages,
        sourceAssetIds: args.sourceAssetIds,
        allowStockImages: args.allowStockImages,
        usageType: args.usageType,
        offerId: args.offerId,
        graphicId: args.graphicId,
      });
      return fixed.success ? fixed.data : null;
    },
  });

  const fixed = fixes.get(0);
  if (fixed) {
    ({ url, objectKey } = await uploadPng(
      args.organizationId,
      args.graphicId,
      0,
      fixed.png
    ));
    ({ width, height } = fixed);
  }

  await commitGraphic(
    args.graphicId,
    [
      {
        slideOrder: 0,
        width,
        height,
        url,
        objectKey,
        slideId: randomUUID(),
      },
    ],
    singleTemplateSlug,
    result.data.renderedCopy
  );
}

/**
 * Bounded-parallel map. Matches `orchestrateCarousel`'s own local helper and
 * its concurrency of 2 — a deck refine issues the same per-slide model calls
 * as a deck compose, so it must not hit the provider any harder.
 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    })()
  );
  await Promise.all(workers);
  return results;
}

const DECK_REFINE_CONCURRENCY = 2;

/**
 * Amend EVERY slide of a carousel from its own prior image.
 *
 * Each slide is refined independently against the pixels currently on it, so
 * an instruction lands surgically per slide instead of the deck being
 * recomposed. Returns false when the source graphic has no usable slides,
 * which tells the caller to compose a fresh deck instead.
 *
 * WHY A FAILED SLIDE DOES NOT FAIL THE DECK
 * -----------------------------------------
 * This is the same failure the video clip operations were built to stop, in a
 * different medium: an edit that touches several things must not destroy the
 * ones it could not complete. If slide 3 errors, its PREVIOUS render is kept
 * and the other four still carry their amendments — the owner gets a mostly
 * amended deck with one slide unchanged, which is recoverable by asking again.
 * Throwing instead would fail the whole job and leave a graphic row in
 * `failed` with none of the work, and re-rolling the failed slide from scratch
 * would silently return a slide that no longer matches the others.
 */
async function refineCarouselDeck(args: {
  graphicId: string;
  organizationId: string;
  serviceId: string;
  topic: string;
  templateSlug: string;
  priorGraphicId: string;
  /** Stated by the caller so the amendment directive matches the ask. */
  regenerationIntent?: 'copy' | 'image' | 'branding' | 'full';
  brandPrimaryColor: string;
  allowAiImages: boolean;
  sourceAssetIds?: string[];
  allowStockImages: boolean;
  refinementInstruction: string;
}): Promise<boolean> {
  const source = await withSystemScope(
    (conn) =>
      conn.query.graphic.findFirst({
        where: eq(graphic.id, args.priorGraphicId),
        columns: { outputs: true },
      }),
    { db }
  );

  // Only slides that actually rendered can be amended — a slide with no URL
  // has no prior pixels to edit.
  const priorOutputs = (source?.outputs ?? []).filter((o) => Boolean(o.url));
  if (priorOutputs.length === 0) return false;

  log.info('Refining whole carousel deck', {
    graphicId: args.graphicId,
    organizationId: args.organizationId,
    priorGraphicId: args.priorGraphicId,
    templateSlug: args.templateSlug,
    slideCount: priorOutputs.length,
  });

  const refined = await mapLimit(
    priorOutputs,
    DECK_REFINE_CONCURRENCY,
    async (prior): Promise<GraphicOutput> => {
      const slideIndex = prior.slideOrder ?? 0;
      try {
        const slide = await regenerateCarouselSlide(db, {
          organizationId: args.organizationId,
          serviceId: args.serviceId,
          topic: args.topic,
          templateSlug: args.templateSlug,
          slideIndex,
          priorImageUrl: prior.url,
          refinementInstruction: args.refinementInstruction,
          graphicId: args.graphicId,
          priorGraphicId: args.priorGraphicId,
          regenerationIntent: args.regenerationIntent,
          provenanceOperation: 'refine-deck',
          model: BRANDED_GRAPHIC_MODEL,
          brandPrimaryColor: args.brandPrimaryColor,
          allowAiImages: args.allowAiImages,
          sourceAssetIds: args.sourceAssetIds,
          allowStockImages: args.allowStockImages,
        });
        if (!slide.success) throw new Error(slide.error.message);

        const { url, objectKey } = await uploadPng(
          args.organizationId,
          args.graphicId,
          slideIndex,
          slide.data.png
        );
        return {
          ...prior,
          width: slide.data.width,
          height: slide.data.height,
          url,
          objectKey,
          renderedAt: new Date().toISOString(),
          status: 'success',
        };
      } catch (error) {
        // Keep the slide the owner already had. Logged loudly because a deck
        // that is only partly amended looks like the edit "half worked", and
        // the reason needs to be findable.
        log.warn('Deck refine: slide failed, keeping its previous render', {
          graphicId: args.graphicId,
          slideIndex,
          error: error instanceof Error ? error.message : String(error),
        });
        return prior;
      }
    }
  );

  await writeGraphicOutputs(args.graphicId, refined, args.templateSlug);
  return true;
}

/**
 * Re-render a single carousel slide refined from its current image, then write
 * the source graphic's preserved slides with that one slide swapped in.
 */
async function refineCarouselSlides(args: {
  graphicId: string;
  organizationId: string;
  serviceId: string;
  topic: string;
  templateSlug: string;
  /** Which slides to re-render or drop. */
  slideInstructions: {
    slideIndex: number;
    op?: 'refine' | 'remove';
    note?: string;
  }[];
  priorGraphicId: string;
  /** Stated by the caller so the amendment directive matches the ask. */
  regenerationIntent?: 'copy' | 'image' | 'branding' | 'full';
  brandPrimaryColor: string;
  allowAiImages: boolean;
  sourceAssetIds?: string[];
  allowStockImages: boolean;
}): Promise<void> {
  // Load the source graphic's existing slides — every slide NOT named is
  // copied across untouched.
  const source = await withSystemScope(
    (conn) =>
      conn.query.graphic.findFirst({
        where: eq(graphic.id, args.priorGraphicId),
        columns: { outputs: true },
      }),
    { db }
  );
  const priorOutputs = source?.outputs ?? [];

  const byIndex = new Map(args.slideInstructions.map((s) => [s.slideIndex, s]));
  const named = priorOutputs.filter((o) => byIndex.has(o.slideOrder ?? -1));
  if (named.length !== byIndex.size) {
    const found = new Set(named.map((o) => o.slideOrder));
    const missing = [...byIndex.keys()].filter((i) => !found.has(i));
    throw new Error(
      `refineCarouselSlides: no prior slide ${missing.join(', ')} on graphic ${args.priorGraphicId}`
    );
  }

  // Removals cost nothing: the surviving slides are already-rendered PNGs, so
  // dropping one is a filter over the preserved set — no model call, no upload.
  const removed = new Set(
    args.slideInstructions
      .filter((s) => s.op === 'remove')
      .map((s) => s.slideIndex)
  );
  const targets = named.filter(
    (o) => !removed.has(o.slideOrder ?? -1) && o.url
  );

  log.info('Refining carousel slides', {
    graphicId: args.graphicId,
    organizationId: args.organizationId,
    refining: [...byIndex.values()].filter((v) => v.op !== 'remove').length,
    removing: [...byIndex.values()].filter((v) => v.op === 'remove').length,
    templateSlug: args.templateSlug,
  });

  // Concurrent, like the whole-deck refine — this IS that loop, narrowed to the
  // named slides and giving each its own instruction. One job, N model calls:
  // "slide 1 says A, slide 2 says B" costs exactly what amending the whole deck
  // costs, which is why it does not have to be N separate re-rolls.
  const refined = await mapLimit(
    targets,
    DECK_REFINE_CONCURRENCY,
    async (prior): Promise<GraphicOutput> => {
      const slideIndex = prior.slideOrder ?? 0;
      const slide = await regenerateCarouselSlide(db, {
        organizationId: args.organizationId,
        serviceId: args.serviceId,
        topic: args.topic,
        templateSlug: args.templateSlug,
        slideIndex,
        priorImageUrl: prior.url as string,
        refinementInstruction: byIndex.get(slideIndex)?.note ?? '',
        graphicId: args.graphicId,
        priorGraphicId: args.priorGraphicId,
        regenerationIntent: args.regenerationIntent,
        provenanceOperation: 'refine-slide',
        model: BRANDED_GRAPHIC_MODEL,
        brandPrimaryColor: args.brandPrimaryColor,
        allowAiImages: args.allowAiImages,
        sourceAssetIds: args.sourceAssetIds,
        allowStockImages: args.allowStockImages,
      });
      if (!slide.success) {
        throw new GraphicJobError(
          `regenerateCarouselSlide failed: ${slide.error.code}: ${slide.error.message}`,
          slide.error.code
        );
      }

      const { url, objectKey } = await uploadPng(
        args.organizationId,
        args.graphicId,
        slideIndex,
        slide.data.png
      );
      return {
        ...prior,
        width: slide.data.width,
        height: slide.data.height,
        url,
        objectKey,
        renderedAt: new Date().toISOString(),
        status: 'success',
      };
    }
  );

  // Splice the freshly rendered slides into the preserved set (the others keep
  // their existing url/objectKey/slideId verbatim), dropping any removals.
  //
  // `slideOrder` is RENUMBERED after a removal so the deck stays contiguous —
  // consumers read these in order, and a gap would render as a missing slide
  // rather than a shorter carousel.
  const refinedByIndex = new Map(refined.map((o) => [o.slideOrder, o]));
  const merged: GraphicOutput[] = priorOutputs
    .filter((o) => !removed.has(o.slideOrder ?? -1))
    .map((o) => refinedByIndex.get(o.slideOrder) ?? o)
    .map((o, position) => ({ ...o, slideOrder: position }));
  await writeGraphicOutputs(args.graphicId, merged, args.templateSlug);
}

// ─── Mode bodies ────────────────────────────────────────────────────────

async function processPlanAndRender(
  job: Job<GraphicGenerateJobPayload>
): Promise<void> {
  if (job.data.mode !== 'plan-and-render') return;
  const {
    graphicId,
    organizationId,
    serviceId,
    kind,
    topicSummary,
    brandPrimaryColor,
    allowAiImages,
    sourceAssetIds,
    allowStockImages,
    usageType,
    offerId,
    refinementInstruction,
    templateSlug,
  } = job.data;

  log.info('Graphic generation started', {
    graphicId,
    organizationId,
    serviceId,
    kind,
    usageType,
    allowAiImages: allowAiImages ?? false,
    allowStockImages: allowStockImages ?? true,
    templateSlug,
  });

  await renderBrandedGraphic({
    graphicId,
    organizationId,
    serviceId,
    topic: topicSummary,
    kind,
    brandPrimaryColor,
    allowAiImages: allowAiImages ?? false,
    sourceAssetIds,
    allowStockImages: allowStockImages ?? true,
    usageType: usageType ?? 'organic',
    offerId,
    refinementInstruction,
    templateSlug,
  });

  if (job.data.whatsappDelivery) {
    await deliverFinishedGraphicToWhatsapp({
      organizationId,
      userId: job.data.whatsappDelivery.userId,
      conversationId: job.data.whatsappDelivery.conversationId,
      graphicId,
    }).catch((err) => {
      log.warn('Claire WhatsApp graphic delivery failed', {
        graphicId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  await job.updateProgress(100);
  log.info(`Graphic generate complete (plan-and-render): ${graphicId}`);
}

async function processRenderOnly(
  job: Job<GraphicGenerateJobPayload>
): Promise<void> {
  if (job.data.mode !== 'render-only') return;
  const {
    graphicId,
    organizationId,
    contentBatchId,
    serviceId,
    topicSummary,
    brandPrimaryColor,
    allowAiImages,
    sourceAssetIds,
    usageType,
    offerId,
    allowStockImages,
    kind,
    refinementInstruction,
    priorImageUrl,
    priorCopy,
    regenerationIntent,
    templateSlug,
    slideInstructions,
    priorGraphicId,
  } = job.data;

  log.info(
    `Generating graphic ${graphicId} (render-only, service=${serviceId}${contentBatchId ? `, batch=${contentBatchId}` : ''})`
  );

  await renderBrandedGraphic({
    graphicId,
    organizationId,
    serviceId,
    topic: topicSummary,
    kind: kind ?? 'single',
    brandPrimaryColor,
    allowAiImages: allowAiImages ?? false,
    sourceAssetIds,
    allowStockImages: allowStockImages ?? true,
    usageType: usageType ?? 'organic',
    offerId,
    refinementInstruction,
    priorImageUrl,
    priorCopy,
    regenerationIntent,
    templateSlug,
    slideInstructions,
    priorGraphicId,
  });

  if (job.data.whatsappDelivery) {
    await deliverFinishedGraphicToWhatsapp({
      organizationId,
      userId: job.data.whatsappDelivery.userId,
      conversationId: job.data.whatsappDelivery.conversationId,
      graphicId,
    }).catch((err) => {
      log.warn('Claire WhatsApp graphic delivery failed', {
        graphicId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  await job.updateProgress(100);
  log.info(`Graphic generate complete (render-only): ${graphicId}`);
}

/**
 * The job handler, exported so it can be driven WITHOUT a queue.
 *
 * `runQualityGate` — inspect, judge the logo, re-render the rejected slides —
 * lives in this file and nowhere else, so any harness that calls
 * `orchestrateCarousel` / `generateTemplatedSingle` directly is testing
 * GENERATION only and silently skipping the stage that decides what ships. A
 * local batch replay looked like "6/6 produced" while three of the six carried
 * a substituted or recoloured logo the gate exists to catch.
 *
 * Exported rather than reimplemented on purpose: a harness that rebuilds this
 * loop is testing the harness. See `scripts/replay-graphic-pipeline.mts`.
 */
export async function processGraphicGenerateJob(
  job: Job<GraphicGenerateJobPayload>
): Promise<void> {
  switch (job.data.mode) {
    case 'plan-and-render':
      await processPlanAndRender(job);
      return;
    case 'render-only':
      await processRenderOnly(job);
      return;
    default: {
      // Exhaustiveness — TS will flag if a new mode is added without a case.
      const _exhaustive: never = job.data;
      throw new Error(
        `Unknown graphic-generate job mode: ${JSON.stringify(_exhaustive)}`
      );
    }
  }
}

export function createGraphicGenerateWorker(): Worker<GraphicGenerateJobPayload> {
  log = createLogger('graphic-generate');

  const redis = getRedis();

  log.info(
    `Starting graphic-generate worker with concurrency: ${GRAPHIC_GENERATE_CONCURRENCY}`
  );

  const worker = new Worker<GraphicGenerateJobPayload>(
    GRAPHIC_GENERATE_QUEUE,
    async (job) => {
      try {
        // One shared admission budget for every Gemini image this job renders,
        // so quota queueing can never outlive the job's lock.
        await runWithGeminiImageAdmissionBudget(
          GRAPHIC_ADMISSION_BUDGET_MS,
          () => processGraphicGenerateJob(job)
        );
      } catch (error) {
        const failure = classifyGraphicFailure(error);
        // A transient image-provider failure with attempts remaining: rethrow
        // for a BullMQ retry WITHOUT marking the graphic failed or notifying
        // the user. This covers 429s plus Gemini 5xx/transport failures after
        // their short in-call retry budget. Terminal failures (retries
        // exhausted) fall through to the failure handling below; the worker
        // `failed` handler also re-asserts `status='failed'` + DLQ on exhaust.
        // (BullMQ v5: attemptsMade is incremented when the job goes active,
        // so inside the processor it already counts the current attempt.)
        if (
          isRetryableImageProviderError(error) &&
          !isPermanentRateLimitFailure(failure) &&
          job.attemptsMade < (job.opts.attempts ?? 1)
        ) {
          log.warn(
            `Job ${job.id} hit a transient image-provider failure — retrying (attempt ${job.attemptsMade}/${job.opts.attempts})`,
            {
              errorCode: failure.code,
              providerCode: failure.providerCode,
              retryable: failure.retryable,
              graphicId: job.data.graphicId,
              organizationId: job.data.organizationId,
              attempt: job.attemptsMade,
              maxAttempts: job.opts.attempts,
            }
          );
          throw error;
        }

        // A provider billing failure cannot recover through queue retries.
        // Discard keeps the original error while making this attempt terminal.
        if (isPermanentRateLimitFailure(failure)) job.discard();

        const logContext = {
          feature: 'video-worker',
          extra: {
            jobId: job.id,
            graphicId: job.data.graphicId,
            organizationId: job.data.organizationId,
            mode: job.data.mode,
            serviceId: job.data.serviceId,
            kind: job.data.kind,
            model: BRANDED_GRAPHIC_MODEL,
            sourceAssetCount: job.data.sourceAssetIds?.length ?? 0,
            errorCode: failure.code,
            userMessage: failure.userMessage,
            providerCode: failure.providerCode,
            retryable: failure.retryable,
            attempt: job.attemptsMade,
            maxAttempts: job.opts.attempts,
            originalCause:
              error instanceof GraphicJobError && error.originalError
                ? error.originalError instanceof Error
                  ? error.originalError.message
                  : String(error.originalError)
                : undefined,
          },
        };
        // Terminal model refusals and billing-cap failures are expected provider
        // outcomes, not application defects — demote to a warning so they do
        // not page Sentry. Everything else logs as an error.
        if (isExpectedImageProviderFailure(error, failure)) {
          log.warn(
            `Graphic ${job.data.graphicId} refused by image model (${failure.providerCode ?? failure.code}) — degrading gracefully`,
            logContext.extra
          );
        } else {
          logError(
            'video-worker.graphicGenerate.processJob',
            error,
            logContext
          );
        }

        // Every mode has a pre-inserted placeholder graphic row at this
        // point (socials inserts on enqueue; bulk + regenerate insert before
        // queueing). Flip them all to 'failed' so the frontend stops polling.
        await markGraphicFailed(job.data.graphicId, failure);

        // Claire-on-WhatsApp: the owner has no polling UI, so push a failure
        // message so they're not left waiting in silence.
        if (job.data.whatsappDelivery) {
          queueClaireWhatsappOutbound({
            organizationId: job.data.organizationId,
            userId: job.data.whatsappDelivery.userId,
            conversationId: job.data.whatsappDelivery.conversationId,
            messages: [
              {
                kind: 'text',
                body: `Sorry, your graphic couldn't be generated. ${failure.userMessage} Error code: ${failure.code}.`,
              },
            ],
            recordAs: 'Notified the owner that graphic generation failed.',
            dedupeKey: `graphic-failed:${job.data.graphicId}`,
          }).catch((err) => {
            log.warn(
              'Failed to enqueue Claire WhatsApp graphic failure notice',
              {
                graphicId: job.data.graphicId,
                error: err instanceof Error ? err.message : String(err),
              }
            );
          });
        }

        throw error;
      }
    },
    {
      connection: redis,
      prefix: getBullMqPrefix(),
      concurrency: GRAPHIC_GENERATE_CONCURRENCY,
      // Shape Gemini throughput: cap job starts per minute so bursts don't
      // stampede the image model into 429 storms.
      limiter: {
        max: GRAPHIC_GENERATE_RATE_PER_MIN,
        duration: 60_000,
      },
      // AI generation + S3 upload of a multi-slide carousel can take ~60s,
      // and the in-call 429 backoff can add up to ~60s more per Gemini call.
      // Give 10 minutes of lock so stalled-detection doesn't fire on a
      // healthy-but-throttled render.
      lockDuration: 600_000,
      stalledInterval: 60_000,
    }
  );

  worker.on('ready', () => {
    log.info('Worker ready and listening for jobs');
  });

  worker.on('active', (job) => {
    log.info(`Job ${job.id} started (mode=${job.data.mode})`);
  });

  worker.on('completed', (job) => {
    log.info(`Job ${job.id} completed`);
  });

  worker.on('failed', async (job, error) => {
    const failure = classifyGraphicFailure(error);
    const failedExtra = {
      jobId: job?.id,
      graphicId: job?.data.graphicId,
      organizationId: job?.data.organizationId,
      mode: job?.data.mode,
      serviceId: job?.data.serviceId,
      errorCode: failure.code,
      userMessage: failure.userMessage,
      providerCode: failure.providerCode,
      retryable: failure.retryable,
      attempt: job?.attemptsMade,
      maxAttempts: job?.opts.attempts,
    };
    // Terminal model refusals and billing caps are expected; keep them out of
    // Sentry (warn only). The persisted graphic failure remains actionable.
    if (isExpectedImageProviderFailure(error, failure)) {
      log.warn(
        `Graphic job ${job?.id} failed via model refusal (${failure.providerCode ?? failure.code})`,
        failedExtra
      );
    } else {
      logError('video-worker.graphicGenerate.jobFailed', error, {
        feature: 'video-worker',
        extra: failedExtra,
      });
    }

    if (job && job.attemptsMade >= (job.opts.attempts || 2)) {
      log.warn(
        `Job ${job.id} exhausted retries (${job.attemptsMade}), moving to DLQ`
      );

      // PRD-40 safety net: re-assert `status='failed'` so the frontend stops
      // polling even if the in-catch markGraphicFailed write was itself lost.
      await markGraphicFailed(job.data.graphicId, failure);

      try {
        await moveToGraphicGenerateDLQ({
          id: job.id || job.data.graphicId,
          data: job.data,
          failedReason: error.message,
          attemptsMade: job.attemptsMade,
        });
      } catch (dlqError) {
        logError(
          'video-worker.graphicGenerate.moveToDeadLetterQueue',
          dlqError,
          {
            feature: 'video-worker',
            extra: { jobId: job.id, graphicId: job.data.graphicId },
          }
        );
      }
    }
  });

  worker.on('error', (error) => {
    if (
      error instanceof Error &&
      error.message.includes('max requests limit exceeded')
    ) {
      log.warn('Redis request limit exceeded — upgrade the Upstash plan');
      return;
    }
    // Other transient Upstash blips (failover/upgrade, severed connection,
    // Lua execution timed out) self-heal — warn instead of paging Sentry (API-58).
    if (isTransientRedisError(error)) {
      log.warn(
        `Transient Redis error (auto-recovering): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }
    logError('video-worker.graphicGenerate.workerError', error, {
      feature: 'video-worker',
      extra: { errorCode: GraphicGenerationErrorCodes.UNEXPECTED },
    });
  });

  return worker;
}

export async function closeGraphicGenerateWorker(
  worker: Worker<GraphicGenerateJobPayload>
): Promise<void> {
  await worker.close();
  log?.info('Worker closed');
}
