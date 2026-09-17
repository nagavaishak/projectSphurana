/**
 * Monthly content-batch generation, split into two phases:
 *
 *   `prepareMonthlyBatch` (FAST, synchronous-safe) — resolves the
 *      `content_batch` row for `(organizationId, periodMonth)`:
 *        - Idempotent by default: a repeat call with neither `append` nor
 *          `replace` returns the existing batch untouched (`shouldSeed:false`).
 *          This is the cron's contract — a repeat monthly run must not
 *          double-seed.
 *        - `append: true` reuses the existing row and computes per-kind
 *          position offsets so new items slot AFTER what's already there.
 *        - `replace: true` wipes the existing queue (deletes every item plus
 *          the video/graphic rows they reference) and resets the row to a
 *          clean `planning` state. The manual "Create Batch" button uses this
 *          so each click regenerates from scratch.
 *      This phase is DB-only (no LLM / no enqueue), so it's cheap enough to
 *      run inside an HTTP request.
 *
 *   `seedMonthlyBatch` (SLOW) — the heavy lifting that must NOT block a
 *      request thread:
 *        2. `planMonthlyContent` → cross-modal plan (videos + carousels +
 *           singles) from one Claude call.
 *        3. `dispatchMonthlyPlan` fans the plan out — video items insert their
 *           own `content_batch_item` + queue their render; image items come
 *           back as `imageRequests`.
 *        4. Each `imageRequest` → placeholder `graphic` row (`status=
 *           'rendering'`) + linking `content_batch_item` + a `graphic-generate`
 *           render-only job.
 *        5. Promote the batch `'planning'` → `'generating'` (or `'failed'`).
 *
 * `generateMonthlyBatch` composes both phases and keeps the original
 * synchronous contract — the cron and smoke tests call it directly. The
 * manual endpoint instead calls `prepareMonthlyBatch` synchronously then fires
 * `seedMonthlyBatch` in the background (see `requestMonthlyBatch`).
 *
 * Failures of individual graphic items are isolated — one bad enqueue
 * doesn't take down the whole batch (matches the dispatcher's
 * video-item policy).
 */

import { randomUUID } from 'node:crypto';
import {
  type ContentBatch,
  type VideoIdea,
  contentAttempt,
  contentBatch,
  contentItem,
  graphic,
  organization,
  socialPost,
  video,
  withOrgScope,
} from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, count, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import { queueGraphicGenerate } from '../../../graphics/services/queue-graphic-generate/index.js';
import {
  DECK_BRIEFS,
  rotateTemplateSlugs,
  singleTemplateSlugs,
} from '../../../image-generation/index.js';
import { dispatchMonthlyPlan } from '../../../monthly-content-plan/services/dispatch-monthly-plan/index.js';
import { planMonthlyContent } from '../../../monthly-content-plan/services/plan-monthly-content/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
  sampleGraphicOutputs,
  sampleVideo,
} from '../../../shared/index.js';
import { generatePostCaption } from '../../../social-posts/services/generate-post-caption/index.js';
import { insertSlotWithFirstAttempt } from '../_shared/index.js';
import { settleBatchStatus } from '../settle-batch-status/index.js';
import {
  type GenerateMonthlyBatchInput,
  generateMonthlyBatchSchema,
} from './generate-monthly-batch.schema.js';

const logger = createLogger('MonthlyBatch');

export interface GenerateMonthlyBatchResponse {
  batch: ContentBatch;
  /** Number of `graphic` rows inserted (placeholder, status='rendering'). */
  graphicsSeeded: number;
  /** Number of video items the dispatcher queued (rows inserted by
   *  `planVideoDetail`). */
  videosSeeded: number;
  /** Number of `graphic-generate` jobs successfully enqueued. */
  jobsEnqueued: number;
  /** Per-item failures from `dispatchMonthlyPlan` plus any graphic
   *  enqueue/insert failures from step 4. Surfaced so the caller can
   *  decide whether to flag the batch. */
  failures: string[];
  /** True when this batch already existed (idempotent return). */
  alreadyExisted: boolean;
}

/**
 * Output of {@link prepareMonthlyBatch}. Everything {@link seedMonthlyBatch}
 * needs to plan and seed a batch, plus the flags that drive the idempotent
 * no-op and the "mark failed on error" policy.
 */
export interface PreparedMonthlyBatch {
  batch: ContentBatch;
  batchId: string;
  organizationId: string;
  periodMonth: string;
  createdById: string;
  graphicCount: number;
  videoCount: number;
  /** Restrict planning to these services only (undefined → all active). */
  serviceIds?: string[];
  /** Whether missing service footage may be filled from curated stock. */
  allowStockFootage: boolean;
  /** Position to slot the first new video item at (0 unless appending). */
  videoPositionOffset: number;
  /** Position to slot the first new graphic item at (0 unless appending). */
  graphicPositionOffset: number;
  /** False for the idempotent no-op (existing batch, no append/replace) —
   *  the caller should return `alreadyExisted` and NOT seed. */
  shouldSeed: boolean;
  /** Whether a seed failure should flip the batch to `'failed'`. True for a
   *  fresh or replaced batch (we own the whole row); false when appending
   *  (the existing batch may hold good content we must not clobber). */
  markFailedOnError: boolean;
}

function currentPeriodMonthUtc(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many days of content one batch covers, measured from the day after it is
 * generated.
 *
 * Batches are no longer bounded to a calendar month — people click "generate"
 * whenever they want, so coverage is relative to when they clicked. This is
 * also what makes the next batch fall due roughly 30 days later instead of at
 * the next month boundary.
 */
export const BATCH_COVERAGE_DAYS = 30;

/** `YYYY-MM-DD` in UTC — the granularity we avoid double-booking at. */
function dayKeyUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * How many graphics this org has already generated — the rotation offset for
 * template assignment.
 *
 * `graphic` rows survive a batch `replace` (their FK lives on the item side and
 * is `set null`), so this keeps advancing across regenerates. That matters: the
 * manual button sends `replace: true`, so an owner clicking generate twice
 * would otherwise reopen on exactly the same designs.
 *
 * Best-effort — a failed count just means offset 0, i.e. the previous
 * behaviour for this batch rather than a failure.
 */
async function fetchTemplateOffset(
  db: DbConnection,
  organizationId: string,
  kind: 'single' | 'carousel'
): Promise<number> {
  try {
    const rows = await withOrgScope(
      (tx) =>
        tx
          .select({ count: count() })
          .from(graphic)
          .where(
            and(
              eq(graphic.organizationId, organizationId),
              // PER POOL. One shared counter over every graphic fed two
              // independent pools of 11, so they interfered: a batch of 4
              // singles + 2 carousels consumed 4 single positions but advanced
              // the offset by 6, skipping designs 4 and 5 permanently and
              // revisiting others sooner than the pool size implies.
              eq(graphic.kind, kind)
            )
          ),
      { db }
    );
    return Number(rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Days in the coverage window that already carry a scheduled social post.
 *
 * Accepted batch items become social posts that survive the next regenerate,
 * and owners generate roughly weekly — so without this each new batch lays its
 * spread over a calendar that is already partly full.
 *
 * Best-effort: an empty set just means we schedule as if the calendar were
 * clear, which is the old behaviour rather than a failure.
 */
async function fetchBookedDays(
  db: DbConnection,
  organizationId: string
): Promise<Set<string>> {
  try {
    const from = new Date();
    const to = new Date(Date.now() + BATCH_COVERAGE_DAYS * 2 * DAY_MS);
    const rows = await withOrgScope(
      (tx) =>
        tx
          .select({ scheduledAt: socialPost.scheduledAt })
          .from(socialPost)
          .where(
            and(
              eq(socialPost.organizationId, organizationId),
              isNotNull(socialPost.scheduledAt),
              gte(socialPost.scheduledAt, from),
              lte(socialPost.scheduledAt, to)
            )
          ),
      { db }
    );
    return new Set(
      rows
        .map((r) => r.scheduledAt)
        .filter((d): d is Date => d instanceof Date)
        .map(dayKeyUtc)
    );
  } catch {
    return new Set();
  }
}

/**
 * Spread N publish times evenly across {@link BATCH_COVERAGE_DAYS} starting
 * tomorrow, at 15:00 UTC.
 *
 * This used to spread across the remainder of the CALENDAR MONTH, which broke
 * badly for the way batches are actually created — people click "generate"
 * whenever, not on the 1st. A batch generated on the 28th had two days of
 * runway, so twelve posts landed roughly four hours apart, and then the next
 * calendar month immediately allowed another batch. Coverage now runs from
 * when the batch was made, so every batch gets the same 30-day runway
 * regardless of the date, and the next one naturally falls due ~30 days later.
 */
export function defaultVideoSchedules(
  count: number,
  takenDays: Set<string> = new Set()
): Date[] {
  if (count <= 0) return [];

  const now = new Date();
  // Earliest slot: tomorrow at 15:00 UTC, so nothing is ever scheduled today
  // or in the past.
  const startMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    15,
    0,
    0,
    0
  );
  const endMs = startMs + (BATCH_COVERAGE_DAYS - 1) * DAY_MS;

  const ideal: number[] = [];
  if (count === 1) {
    ideal.push(startMs);
  } else {
    const stepMs = (endMs - startMs) / (count - 1);
    for (let i = 0; i < count; i += 1) {
      ideal.push(startMs + Math.round(i * stepMs));
    }
  }

  // Owners generate roughly weekly, and accepted items become social posts
  // that SURVIVE the next regenerate. Computing each batch's spread in
  // isolation therefore stacks new content onto days that are already booked.
  // Nudge each slot forward to the first free day; `claimed` also stops two
  // slots inside THIS batch colliding once they start shifting.
  const claimed = new Set(takenDays);
  const schedules: Date[] = [];
  for (const slotMs of ideal) {
    let ms = slotMs;
    // Bounded: never search beyond one extra coverage window, so a fully
    // booked calendar degrades to "stack it anyway" rather than looping.
    for (let probe = 0; probe < BATCH_COVERAGE_DAYS; probe += 1) {
      if (!claimed.has(dayKeyUtc(new Date(ms)))) break;
      ms += DAY_MS;
    }
    claimed.add(dayKeyUtc(new Date(ms)));
    schedules.push(new Date(ms));
  }
  return schedules.sort((a, b) => a.getTime() - b.getTime());
}

// ── Phase 1: prepare ──────────────────────────────────────────────────────

/**
 * Resolve (find / create / replace) the batch row for the requested month.
 * DB-only and fast — safe to await inside an HTTP request. Returns a
 * {@link PreparedMonthlyBatch} describing what to seed; `shouldSeed:false`
 * means an existing batch was returned untouched (idempotent no-op).
 */
export const prepareMonthlyBatch = async (
  db: DbConnection,
  input: GenerateMonthlyBatchInput
): Promise<Result<PreparedMonthlyBatch>> => {
  const parsed = generateMonthlyBatchSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const periodMonth = parsed.data.periodMonth ?? currentPeriodMonthUtc();
  const {
    organizationId,
    createdById,
    graphicCount,
    videoCount,
    append,
    replace,
    serviceIds,
    allowStockFootage,
  } = parsed.data;

  const existing = await withOrgScope(
    (tx) =>
      tx.query.contentBatch.findFirst({
        where: and(
          eq(contentBatch.organizationId, organizationId),
          eq(contentBatch.periodMonth, periodMonth)
        ),
      }),
    { db }
  );

  const base = {
    organizationId,
    periodMonth,
    createdById,
    graphicCount,
    videoCount,
    serviceIds,
    allowStockFootage,
  };

  // Idempotent path: a batch already exists and the caller asked for neither
  // append nor replace. The cron relies on this — a repeat monthly run must
  // not double-seed — as does any plain re-trigger.
  if (existing && !append && !replace) {
    return ok({
      ...base,
      batch: existing,
      batchId: existing.id,
      videoPositionOffset: 0,
      graphicPositionOffset: 0,
      shouldSeed: false,
      markFailedOnError: false,
    });
  }

  if (existing && replace) {
    // ── Replace: wipe the existing queue before seeding ──────────────────
    // Delete every batch item plus the video/graphic rows they reference so
    // a fresh batch fully supersedes whatever was pending. All FKs onto
    // video/graphic are `set null`/`cascade`, so these deletes are safe.
    // Offsets stay at 0 — the new items take positions from the top.
    // Asset ids live on the attempts now, and EVERY attempt matters here, not
    // just the current one: a slot that was regenerated owns several videos,
    // and wiping the batch has to clean up all of them or they leak.
    const priorItems = await db.query.contentAttempt.findMany({
      where: eq(contentAttempt.batchId, existing.id),
      columns: { videoId: true, graphicId: true },
    });

    await db.delete(contentItem).where(eq(contentItem.batchId, existing.id));

    const priorVideoIds = priorItems
      .map((i) => i.videoId)
      .filter((id): id is string => !!id);
    const priorGraphicIds = priorItems
      .map((i) => i.graphicId)
      .filter((id): id is string => !!id);

    // Cleanup is best-effort (an orphaned asset row must not block the
    // replace) but never silent — a failure here leaks rows.
    if (priorVideoIds.length > 0) {
      await db
        .update(video)
        .set({ deletedAt: new Date() })
        .where(and(inArray(video.id, priorVideoIds), notDeleted(video)))
        .catch((error) => {
          logError('contentBatches.prepareMonthlyBatch.replaceCleanup', error, {
            feature: 'content-batches',
            extra: {
              batchId: existing.id,
              organizationId,
              kind: 'video',
              ids: priorVideoIds,
            },
          });
        });
    }
    if (priorGraphicIds.length > 0) {
      await db
        .delete(graphic)
        .where(inArray(graphic.id, priorGraphicIds))
        .catch((error) => {
          logError('contentBatches.prepareMonthlyBatch.replaceCleanup', error, {
            feature: 'content-batches',
            extra: {
              batchId: existing.id,
              organizationId,
              kind: 'graphic',
              ids: priorGraphicIds,
            },
          });
        });
    }

    // Reset the batch back to a clean planning state — clear any prior
    // review/finalise/error markers so the regenerated batch reads as new.
    const [reset] = await withOrgScope(
      (tx) =>
        tx
          .update(contentBatch)
          .set({
            status: 'planning',
            reviewedAt: null,
            finaliseAt: null,
            errorMessage: null,
            updatedAt: new Date(),
          })
          .where(eq(contentBatch.id, existing.id))
          .returning(),
      { db }
    );

    return ok({
      ...base,
      batch: reset ?? existing,
      batchId: existing.id,
      videoPositionOffset: 0,
      graphicPositionOffset: 0,
      shouldSeed: true,
      markFailedOnError: true,
    });
  }

  if (existing) {
    // ── Append: slot new items after the existing ones ───────────────────
    let videoPositionOffset = 0;
    let graphicPositionOffset = 0;
    const priorItems = await db.query.contentItem.findMany({
      where: eq(contentItem.batchId, existing.id),
      columns: { kind: true, position: true },
    });
    for (const it of priorItems) {
      // A batch item always has a position; the column is only nullable for
      // standalone items, which by definition have no `batchId` to be found by
      // the query above. Skip rather than coerce, so a null can never silently
      // read as position 0 and collide with a real first slot.
      if (it.position === null) continue;
      if (it.kind === 'video') {
        videoPositionOffset = Math.max(videoPositionOffset, it.position + 1);
      } else if (it.kind === 'graphic') {
        graphicPositionOffset = Math.max(
          graphicPositionOffset,
          it.position + 1
        );
      }
    }
    // Back to 'planning' for the top-up seed, exactly like a fresh batch.
    // `planning` is the ONE status that means "asked for, items not landed
    // yet": the client polls on it and holds the button closed. Leaving an
    // append on 'generating' left that window unmarked — polling stopped and
    // the button re-armed before the new slots existed. Prior review markers
    // stay put; this batch already holds accepted content.
    const [reset] = await withOrgScope(
      (tx) =>
        tx
          .update(contentBatch)
          .set({
            status: 'planning',
            errorMessage: null,
            updatedAt: new Date(),
          })
          .where(eq(contentBatch.id, existing.id))
          .returning(),
      { db }
    );

    return ok({
      ...base,
      batch: reset ?? existing,
      batchId: existing.id,
      videoPositionOffset,
      graphicPositionOffset,
      shouldSeed: true,
      // Appending into a batch that may already hold reviewed/scheduled
      // content — don't flip the whole thing to failed on a seed error.
      markFailedOnError: false,
    });
  }

  // ── Fresh batch ────────────────────────────────────────────────────────
  const batchId = randomUUID();
  const [created] = await withOrgScope(
    (tx) =>
      tx
        .insert(contentBatch)
        .values({
          id: batchId,
          organizationId,
          periodMonth,
          status: 'planning',
        })
        .returning(),
    { db }
  );

  if (!created) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create content_batch row'
      )
    );
  }

  return ok({
    ...base,
    batch: created,
    batchId,
    videoPositionOffset: 0,
    graphicPositionOffset: 0,
    shouldSeed: true,
    markFailedOnError: true,
  });
};

// ── Phase 2: seed (slow) ────────────────────────────────────────────────

/**
 * Dev-only (`ONBOARDING_SAMPLE_ASSETS`): seed the batch with ready sample
 * graphics + videos and their `content_batch_item` rows instead of planning +
 * queuing real renders. Items land as `reviewStatus: 'pending'` (the user
 * still approves each), with the underlying assets already `status: 'ready'`
 * so the approval slide renders them immediately.
 */
const seedSampleBatch = async (
  db: DbConnection,
  prepared: PreparedMonthlyBatch
): Promise<Result<GenerateMonthlyBatchResponse>> => {
  const {
    batch: batchRow,
    batchId,
    organizationId,
    periodMonth,
    createdById,
    graphicCount,
    videoCount,
    videoPositionOffset,
    graphicPositionOffset,
  } = prepared;

  // Don't stack onto days that already carry a scheduled post.
  const bookedDays = await fetchBookedDays(db, organizationId);
  const videoSchedules = defaultVideoSchedules(videoCount, bookedDays);
  const graphicSchedules = defaultVideoSchedules(graphicCount).map((d) => {
    const at = new Date(d);
    at.setUTCHours(10, 0, 0, 0);
    return at;
  });

  let videosSeeded = 0;
  for (let i = 0; i < videoCount; i++) {
    const videoId = randomUUID();
    const { blobUrl, thumbnailUrl } = sampleVideo(i);
    await db.insert(video).values({
      id: videoId,
      title: `Sample video ${i + 1}`,
      status: 'ready',
      usageType: 'organic',
      organizationId,
      createdById,
      blobUrl,
      thumbnailUrl,
    });
    await insertSlotWithFirstAttempt(db, {
      organizationId,
      batchId,
      source: 'monthly_batch',
      kind: 'video',
      videoId,
      position: videoPositionOffset + i,
      caption: 'Sample video post — edit me before publishing.',
      scheduledAt: videoSchedules[i] ?? null,
    });
    videosSeeded += 1;
  }

  let graphicsSeeded = 0;
  for (let i = 0; i < graphicCount; i++) {
    const graphicId = randomUUID();
    await db.insert(graphic).values({
      id: graphicId,
      title: `Monthly batch ${periodMonth}`,
      status: 'ready',
      usageType: 'organic',
      aspectRatio: '4:5',
      canvasWidth: 1080,
      canvasHeight: 1350,
      outputs: sampleGraphicOutputs(i),
      organizationId,
      createdById,
    });
    await insertSlotWithFirstAttempt(db, {
      organizationId,
      batchId,
      source: 'monthly_batch',
      kind: 'graphic',
      graphicId,
      position: graphicPositionOffset + i,
      caption: 'Sample graphic post — edit me before publishing.',
      scheduledAt: graphicSchedules[i] ?? null,
    });
    graphicsSeeded += 1;
  }

  const [promoted] = await withOrgScope(
    (tx) =>
      tx
        .update(contentBatch)
        .set({ status: 'generating', updatedAt: new Date() })
        .where(eq(contentBatch.id, batchId))
        .returning(),
    { db }
  );

  // Sample assets are born 'ready', so this batch never has a render to wait
  // for — settle it straight to 'review' rather than handing back a finished
  // batch that claims to be generating.
  const updated = await settleIntoRow(db, batchId, promoted);

  return ok({
    batch: updated ?? batchRow,
    graphicsSeeded,
    videosSeeded,
    jobsEnqueued: 0,
    failures: [],
    alreadyExisted: false,
  });
};

/**
 * Settle the freshly-seeded batch and return the row carrying the settled
 * status, so the caller hands back what the batch IS rather than the
 * 'generating' it held for the microsecond between the promote and the settle.
 */
const settleIntoRow = async (
  db: DbConnection,
  batchId: string,
  promoted: ContentBatch | undefined
): Promise<ContentBatch | undefined> => {
  const settled = await settleBatchStatus(db, { batchId });
  if (!promoted || !settled.success) return promoted;
  return { ...promoted, status: settled.data.status };
};

const seedMonthlyBatchImpl = async (
  db: DbConnection,
  prepared: PreparedMonthlyBatch
): Promise<Result<GenerateMonthlyBatchResponse>> => {
  const {
    batch: batchRow,
    batchId,
    organizationId,
    periodMonth,
    createdById,
    graphicCount,
    videoCount,
    serviceIds,
    allowStockFootage,
    videoPositionOffset,
    graphicPositionOffset,
    markFailedOnError,
  } = prepared;

  // Dev-only shortcut: skip planning + the render pipeline and seed the batch
  // with ready sample assets so the content-approval slide fills instantly.
  if (apiEnv.ONBOARDING_SAMPLE_ASSETS) {
    return seedSampleBatch(db, prepared);
  }

  const markBatchFailed = async (reason: string) => {
    // An append seed failing must not condemn the batch — it still holds the
    // content the owner already accepted. But it must still LEAVE 'planning',
    // or the client polls a seed window that never closes. Drop it back to
    // 'generating' (its status before the top-up) carrying the reason.
    const status = markFailedOnError ? 'failed' : 'generating';
    await withOrgScope(
      (tx) =>
        tx
          .update(contentBatch)
          .set({
            status,
            errorMessage: reason,
            updatedAt: new Date(),
          })
          .where(eq(contentBatch.id, batchId)),
      { db }
    ).catch((error) => {
      // If this write fails the batch is stranded in a non-terminal status
      // that the UI polls forever — the one failure that must never be silent.
      logError('contentBatches.seedMonthlyBatch.markBatchFailed', error, {
        feature: 'content-batches',
        extra: { batchId, organizationId, periodMonth, reason },
      });
    });
  };

  // ── 2. Look up org brand-primary-color (for queue payload) ─────────────
  // The worker needs a brand primary color to render against. Mirrors the
  // socials path's fallback.
  const orgRow = await db.query.organization.findFirst({
    where: and(eq(organization.id, organizationId), notDeleted(organization)),
    columns: { id: true, primaryColor: true },
  });
  const brandPrimaryColor = orgRow?.primaryColor ?? '#6366F1';

  // ── 3. Plan cross-modal content ────────────────────────────────────────
  // Split the requested graphic count evenly across carousel + single. The
  // legacy planner had only `graphicCount` — under the new unified
  // planner, callers can override carouselCount / singleCount later if
  // they want a different mix.
  const carouselCount = Math.ceil(graphicCount / 2);
  const singleCount = graphicCount - carouselCount;

  const planResult = await planMonthlyContent(db, {
    organizationId,
    periodMonth,
    videoCount,
    carouselCount,
    singleCount,
    serviceIds,
    allowStockFootage,
    recentTopicsLookbackDays: 60,
  });

  if (!planResult.success) {
    await markBatchFailed(`Planning failed: ${planResult.error.message}`);
    return err(
      new FeatureError(
        planResult.error.code as (typeof ErrorCodes)[keyof typeof ErrorCodes],
        `Plan generation failed: ${planResult.error.message}`
      )
    );
  }

  const plan = planResult.data;

  // ── 4. Dispatch the plan ───────────────────────────────────────────────
  // Video items insert their own batch_item + queue their own render
  // inside the dispatcher. Image items come back as `imageRequests` — we
  // materialise those below.
  const videoItemCount = plan.items.filter((i) => i.kind === 'video').length;
  // Owners generate roughly weekly and accepted items become social posts that
  // survive the next regenerate, so spread around what is already booked
  // rather than stacking onto it.
  const bookedDays = await fetchBookedDays(db, organizationId);
  const videoSchedules = defaultVideoSchedules(videoItemCount, bookedDays);

  const dispatchResult = await dispatchMonthlyPlan(db, {
    plan,
    batchId,
    createdById,
    videoSchedules,
    targetPageIds: [],
    videoPositionOffset,
    graphicPositionOffset,
    allowStockFootage,
  });

  if (!dispatchResult.success) {
    await markBatchFailed(`Dispatch failed: ${dispatchResult.error.message}`);
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        `Dispatch failed: ${dispatchResult.error.message}`
      )
    );
  }

  const {
    videoIds,
    imageRequests,
    failures: dispatchFailures,
  } = dispatchResult.data;

  // ── 5. Materialise image requests into graphic + batch_item + jobs ────
  const failures: string[] = dispatchFailures.map(
    (f) => `[${f.kind} idx=${f.index}] ${f.error}`
  );
  let graphicsSeeded = 0;
  let jobsEnqueued = 0;
  // When appending, slot graphics after the batch's existing graphic items.
  let graphicPosition = graphicPositionOffset;

  // Spread graphic post-times across the coverage window, like videos, but at
  // 10:00 UTC so they don't land on the exact same slot as the 15:00 videos.
  const graphicSchedules = defaultVideoSchedules(
    imageRequests.length,
    bookedDays
  ).map((d) => {
    const at = new Date(d);
    at.setUTCHours(10, 0, 0, 0);
    return at;
  });

  // Assign designs by POSITION from a per-org offset rather than hashing each
  // graphic's random id. Six organic single templates means a batch of more
  // than six would otherwise repeat designs by pigeonhole, and a fresh random
  // draw per regenerate is why "it looks like last month" survives new copy.
  // Computed here, where every position is known, so there is no race.
  // One offset PER POOL. Sharing a single counter across two independent pools
  // of 11 made them interfere — see `fetchTemplateOffset`.
  const [singleOffset, carouselOffset] = await Promise.all([
    fetchTemplateOffset(db, organizationId, 'single'),
    fetchTemplateOffset(db, organizationId, 'carousel'),
  ]);
  const singlePool = singleTemplateSlugs('organic');
  // Carousels rotate across BRIEFS — decks are built from a subject, not a
  // composition, so the pool that gives a month its variety is the brief list.
  const carouselPool = DECK_BRIEFS.map((b) => b.slug);
  const singleSlugs = rotateTemplateSlugs(
    singlePool,
    imageRequests.filter((r) => r.kind !== 'carousel').length,
    singleOffset
  );
  const carouselSlugs = rotateTemplateSlugs(
    carouselPool,
    imageRequests.filter((r) => r.kind === 'carousel').length,
    carouselOffset
  );
  let singleCursor = 0;
  let carouselCursor = 0;

  for (const [imageIndex, request] of imageRequests.entries()) {
    const newGraphicId = request.graphicId;
    try {
      // Placeholder graphic row. Same shape the socials path uses — the
      // worker upserts to status='ready' (or 'failed') once the render
      // lands.
      const [graphicRow] = await db
        .insert(graphic)
        .values({
          id: newGraphicId,
          title: `Monthly batch ${periodMonth}`,
          status: 'rendering',
          usageType: 'organic',
          serviceId: request.targetServiceId,
          topicSummary: request.topicSummary,
          kind: request.kind,
          // aspectRatio / canvas dims are hard-coded for v1.
          aspectRatio: '4:5',
          canvasWidth: 1080,
          canvasHeight: 1350,
          outputs: null,
          organizationId,
          createdById,
        })
        .returning();

      if (!graphicRow) {
        logError(
          'contentBatches.seedMonthlyBatch.materialise',
          new Error(`graphic insert returned no row for ${newGraphicId}`),
          {
            feature: 'content-batches',
            extra: { batchId, organizationId, graphicId: newGraphicId },
          }
        );
        failures.push(`graphic insert returned no row for ${newGraphicId}`);
        continue;
      }
      graphicsSeeded += 1;

      // Auto-generate a caption that matches the graphic's topic (best-effort
      // — a caption miss must not drop the slot). Falls back to the topic
      // itself so review still has on-subject copy to edit.
      let caption: string | null = null;
      const captionResult = await generatePostCaption(db, {
        organizationId,
        idea: ideaFromImageTopic(request.topicSummary, request.serviceName),
      });
      caption = captionResult.success
        ? captionResult.data.caption
        : request.topicSummary;

      // Linking content_batch_item row at the next available position, with
      // the matching caption and an auto-set publish time pre-filled for
      // review (mirrors what videos get from `planVideoDetail`).
      await insertSlotWithFirstAttempt(db, {
        organizationId,
        batchId,
        source: 'monthly_batch',
        kind: 'graphic',
        graphicId: newGraphicId,
        position: graphicPosition,
        caption,
        scheduledAt: graphicSchedules[imageIndex] ?? null,
      });
      graphicPosition += 1;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError(
        'contentBatches.seedMonthlyBatch.materialise',
        error instanceof Error ? error : new Error(msg),
        {
          feature: 'content-batches',
          extra: {
            batchId,
            organizationId,
            graphicId: newGraphicId,
          },
        }
      );
      failures.push(`graphic ${newGraphicId} materialise: ${msg}`);
      continue;
    }

    // Enqueue the render-only job. The worker generates from the org's real
    // service media + brand corpus keyed by serviceId + topic.
    //
    // THE BATCH NOW BACKSTOPS WITH INVENTED IMAGERY. It used to pin
    // `allowAiImages: false`, which resolves to `own-then-stock` — and that
    // policy accepts a clip from the ambient stock pool, which answers almost
    // always and frequently with something unrelated (an IV drip for a
    // cryotherapy facial). With AI permitted the policy becomes
    // `own-then-stock-then-ai`: the org's own verified photo first, then stock
    // ONLY when the matcher genuinely linked the clip to this service, then an
    // invented image. Generic beats wrong, and wrong is what "no invented
    // imagery" was actually buying.
    const enqueueResult = await queueGraphicGenerate({
      mode: 'render-only',
      graphicId: newGraphicId,
      organizationId,
      contentBatchId: batchId,
      brandPrimaryColor,
      serviceId: request.targetServiceId,
      topicSummary: request.topicSummary,
      allowAiImages: true,
      kind: request.kind,
      templateSlug:
        request.kind === 'carousel'
          ? carouselSlugs[carouselCursor++]
          : singleSlugs[singleCursor++],
    });

    if (!enqueueResult.success) {
      logError('contentBatches.seedMonthlyBatch.enqueue', enqueueResult.error, {
        feature: 'content-batches',
        extra: { batchId, organizationId, graphicId: newGraphicId },
      });
      // Flip the graphic row to failed so the UI doesn't hang.
      await db
        .update(graphic)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(graphic.id, newGraphicId))
        .catch((error) => {
          // A swallowed failure here leaves the graphic stuck 'rendering'
          // (endless spinner in review) — log it so the stuck row is traceable.
          logError('contentBatches.seedMonthlyBatch.markGraphicFailed', error, {
            feature: 'content-batches',
            extra: { batchId, organizationId, graphicId: newGraphicId },
          });
        });
      failures.push(
        `graphic ${newGraphicId} enqueue: ${enqueueResult.error.message}`
      );
      continue;
    }
    jobsEnqueued += 1;
  }

  // ── Roll-up: surface partial seeding loudly ───────────────────────────
  // Per-item failures are isolated (one bad slot doesn't kill the batch) and
  // each is logged at the dispatcher/materialise level — but until now the
  // BATCH outcome gave no single signal that it under-seeded, so a regression
  // (e.g. a whole template class failing idea-gen) stayed invisible. Emit a
  // "seeded N of M (X failed)" roll-up keyed off the planned item count so
  // future drops show up as one line per batch.
  const videosSeeded = videoIds.length;
  const plannedCount = plan.items.length;
  const seededCount = videosSeeded + graphicsSeeded;
  if (failures.length > 0) {
    logger.warn(
      `Batch under-seeded: ${seededCount} of ${plannedCount} items (${failures.length} failed)`,
      {
        organizationId,
        periodMonth,
        batchId,
        plannedCount,
        seededCount,
        videosSeeded,
        graphicsSeeded,
        jobsEnqueued,
        failureCount: failures.length,
        failures,
      }
    );
  }

  // Every planned item failed to seed — promoting to 'generating' would leave
  // the UI polling an empty batch forever. Flip it to failed with the real
  // reasons instead — on append that lands back on 'generating' with the
  // reason attached, keeping the prior good content.
  if (plannedCount > 0 && seededCount === 0) {
    const reason = `All ${plannedCount} planned items failed to seed: ${failures
      .slice(0, 3)
      .join('; ')}`.slice(0, 500);
    await markBatchFailed(reason);
    return err(new FeatureError(ErrorCodes.INTERNAL_ERROR, reason));
  }

  // ── 6. Promote batch to 'generating' ──────────────────────────────────
  // Partial seed failures are persisted on the row so the client can surface
  // "N of M items couldn't be generated" — previously the summary lived only
  // in a return value nobody awaits (ENG-494).
  const partialFailureSummary =
    failures.length > 0
      ? `${failures.length} of ${plannedCount} planned items couldn't be generated`
      : null;
  const [promoted] = await withOrgScope(
    (tx) =>
      tx
        .update(contentBatch)
        .set({
          status: 'generating',
          errorMessage: partialFailureSummary,
          updatedAt: new Date(),
        })
        .where(eq(contentBatch.id, batchId))
        .returning(),
    { db }
  );

  // 'generating' is the honest status the instant the slots exist, but not
  // necessarily a moment later: a render can already have landed, and a slot
  // that never enqueued would otherwise be outstanding forever. Settle once
  // here so the batch starts from the truth; the worker settles it after each
  // render from then on.
  const updated = await settleIntoRow(db, batchId, promoted);

  return ok({
    batch: updated ?? batchRow,
    graphicsSeeded,
    videosSeeded,
    jobsEnqueued,
    failures,
    // We actually seeded content (fresh batch / replace / append top-up), so
    // this is never the idempotent no-op return. `alreadyExisted` is reserved
    // for that case, handled by the caller.
    alreadyExisted: false,
  });
};

/**
 * Run the slow plan + seed phase against an already-prepared batch. Wrapped
 * in `trackedResult` so its failures are logged even when fired in the
 * background (nobody awaits it on the manual-trigger path).
 */
export const seedMonthlyBatch = (
  db: DbConnection,
  prepared: PreparedMonthlyBatch
) =>
  trackedResult(
    'contentBatches.seedMonthlyBatch',
    () => seedMonthlyBatchImpl(db, prepared),
    {
      properties: {
        organizationId: prepared.organizationId,
        periodMonth: prepared.periodMonth,
        batchId: prepared.batchId,
      },
    }
  );

// ── Composition: the original synchronous contract (cron / smoke tests) ───

/**
 * Build a min-length-safe `VideoIdea` from an image item's topic + service so
 * `generatePostCaption` can write a caption that MATCHES the graphic — both
 * stem from the same `topicSummary`, so they stay on the same subject. Fields
 * are composed into readable phrases (never padded) to clear the
 * `videoIdeaSchema` minimums.
 */
function ideaFromImageTopic(
  topicSummary: string,
  serviceName: string
): VideoIdea {
  const topic = topicSummary.trim();
  return {
    topic:
      topic.length >= 30
        ? topic
        : `${topic} — what to know about ${serviceName}`,
    angle: `Why ${serviceName} is worth a closer look`,
    payoff: `See how ${serviceName} can help and what to expect`,
    audience: `People considering ${serviceName}`,
    serviceName,
  };
}

const generateMonthlyBatchImpl = async (
  db: DbConnection,
  input: GenerateMonthlyBatchInput
): Promise<Result<GenerateMonthlyBatchResponse>> => {
  const prepResult = await prepareMonthlyBatch(db, input);
  if (!prepResult.success) return prepResult;

  const prepared = prepResult.data;
  if (!prepared.shouldSeed) {
    return ok({
      batch: prepared.batch,
      graphicsSeeded: 0,
      videosSeeded: 0,
      jobsEnqueued: 0,
      failures: [],
      alreadyExisted: true,
    });
  }

  return seedMonthlyBatchImpl(db, prepared);
};

export const generateMonthlyBatch = (
  db: DbConnection,
  input: GenerateMonthlyBatchInput
) =>
  trackedResult(
    'contentBatches.generateMonthlyBatch',
    () => generateMonthlyBatchImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        periodMonth: input.periodMonth,
      },
    }
  );

export type GenerateMonthlyBatchResult = Awaited<
  ReturnType<typeof generateMonthlyBatch>
>;
