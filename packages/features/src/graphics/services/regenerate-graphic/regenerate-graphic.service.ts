/**
 * `regenerateGraphic` — THE re-roll for a graphic. One implementation, three
 * callers: the create-post review modal, the onboarding ad-picker
 * (`regenerateAdCandidate`), and monthly batch posts (`regenerateBatchItem`).
 *
 * Keyed on the graphic id, so it knows nothing about what is pointing at that
 * graphic — a batch slot, an onboarding session, or nothing at all. Callers own
 * their own bookkeeping and call this for the render.
 *
 * It PINS the original's `templateSlug` so the design doesn't drift to a
 * different layout, carries the prior copy forward so a change request AMENDS
 * rather than reinvents, and anchors the render to what it is editing.
 * `scope: 'slide'` refines just one carousel slide (from its prior image) and
 * preserves the rest.
 *
 * Inserts a fresh placeholder graphic (status='rendering'), enqueues a
 * render-only job, and returns the placeholder for the client to poll. The
 * source is never modified, which is why every caller can treat a re-roll as
 * additive and roll its own state back independently.
 *
 * HISTORY: `regenerateBatchItem` used to re-implement all of this inline —
 * load source, resolve brand primary, insert a pinned placeholder, enqueue
 * render-only, flip to failed. The copy had drifted: it passed no anchor at all
 * for a whole-carousel re-roll, so batch carousel refinements replanned the
 * deck from scratch instead of editing it. Do not fork this again.
 */

import { randomUUID } from 'node:crypto';
import {
  type Graphic,
  graphic,
  organization,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { queueGraphicGenerate } from '../queue-graphic-generate/index.js';
import {
  type RegenerateGraphicInput,
  regenerateGraphicSchema,
} from './regenerate-graphic.schema.js';

const regenerateGraphicImpl = async (
  db: DbConnection,
  input: RegenerateGraphicInput
): Promise<Result<Graphic>> => {
  const parsed = regenerateGraphicSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const {
    organizationId,
    graphicId,
    createdById,
    contentBatchId,
    refinementInstruction,
    regenerationIntent,
    scope,
    slideIndex,
    slideEdits,
    sourceAssetIds,
    whatsappDelivery,
  } = parsed.data;

  // ── 1. Load the source graphic (org-scoped) ───────────────────────────
  const source = await db.query.graphic.findFirst({
    where: and(
      eq(graphic.id, graphicId),
      eq(graphic.organizationId, organizationId)
    ),
  });
  if (!source) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Graphic not found'));
  }
  if (!source.serviceId) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Graphic has no service to regenerate from'
      )
    );
  }
  // A paid-ad graphic that predates offer tracking (no offerId) can't reproduce
  // its offer context. Rather than blocking the owner, regenerate it as organic
  // — no worse than the graphic already is, and the common organic path is
  // unchanged.
  const effectiveUsageType =
    source.usageType === 'ad' && !source.offerId ? 'organic' : source.usageType;

  // ── Normalise the two per-slide shapes into ONE ───────────────────────
  //
  // `slideEdits` (a list, each with its own note) and `scope: 'slide'` +
  // `slideIndex` (one slide, using the top-level instruction) say the same
  // thing at different widths. Collapsing them here means everything below —
  // and the worker — deals with a single representation, instead of two that
  // have to be kept in step.
  //
  // Single graphics have no per-slide concept, so slide targeting coerces to a
  // full re-render rather than erroring: the owner asked for a change, and the
  // whole image IS the slide.
  // A caller that asks for slide scope without naming a slide has a bug —
  // coercing it to a whole-asset re-roll would hide that and quietly re-render
  // the entire deck.
  if (
    scope === 'slide' &&
    slideIndex === undefined &&
    !slideEdits?.length &&
    source.kind === 'carousel'
  ) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'slideIndex is required when scope = "slide"'
      )
    );
  }

  const requestedSlides: {
    slideIndex: number;
    op: 'refine' | 'remove';
    note?: string;
  }[] =
    slideEdits && slideEdits.length > 0
      ? slideEdits
      : scope === 'slide' && slideIndex !== undefined
        ? [
            {
              slideIndex,
              op: 'refine' as const,
              note: refinementInstruction ?? '',
            },
          ]
        : [];

  // A refine with no instruction is a no-op dressed as work — it would spend a
  // model call to reproduce the slide. A remove needs no instruction at all.
  const targetedSlides =
    source.kind === 'carousel'
      ? requestedSlides.filter(
          (edit) => edit.op === 'remove' || (edit.note?.trim().length ?? 0) > 0
        )
      : [];
  const effectiveScope = targetedSlides.length > 0 ? 'slide' : 'all';

  if (effectiveScope === 'slide') {
    if (!source.templateSlug) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'This graphic predates template pinning — regenerate all slides instead'
        )
      );
    }
    // Validate EVERY named slide before rendering any of them: a job that
    // refines two slides and then discovers the third does not exist has
    // already spent two model calls and left the deck half-amended.
    const available = new Set(
      (source.outputs ?? [])
        .map((o) => o.slideOrder)
        .filter((n) => n !== undefined)
    );
    const missing = targetedSlides
      .map((edit) => edit.slideIndex)
      .filter((index) => !available.has(index));
    if (missing.length > 0) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          `Slide ${missing.join(', ')} not found on this graphic`
        )
      );
    }
    // A carousel needs at least two slides. Removing down to one would leave a
    // deck the platforms will not accept, so refuse rather than render it.
    const removing = targetedSlides.filter((e) => e.op === 'remove').length;
    if (removing > 0 && (source.outputs ?? []).length - removing < 2) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'A carousel needs at least two slides — remove fewer, or regenerate it as a single image'
        )
      );
    }

    const seen = new Set<number>();
    for (const edit of targetedSlides) {
      if (seen.has(edit.slideIndex)) {
        return err(
          new FeatureError(
            ErrorCodes.VALIDATION_ERROR,
            `Slide ${edit.slideIndex} was given two different instructions`
          )
        );
      }
      seen.add(edit.slideIndex);
    }
  }

  // ── 2. Resolve brand primary colour for the renderer ───────────────────
  const orgRow = await db.query.organization.findFirst({
    where: and(eq(organization.id, organizationId), notDeleted(organization)),
    columns: { primaryColor: true },
  });
  const brandPrimaryColor = orgRow?.primaryColor ?? '#6366F1';

  // ── 3. Insert the replacement placeholder graphic ──────────────────────
  const newGraphicId = randomUUID();
  let inserted: Graphic | undefined;
  try {
    const [row] = await db
      .insert(graphic)
      .values({
        id: newGraphicId,
        title: source.title ? `${source.title} (edited)` : 'Regenerating',
        status: 'rendering',
        usageType: effectiveUsageType,
        offerId: source.offerId,
        sourceAssetIds: sourceAssetIds ?? source.sourceAssetIds,
        allowAiImages: source.allowAiImages,
        serviceId: source.serviceId,
        topicSummary: source.topicSummary,
        kind: source.kind,
        aspectRatio: source.aspectRatio,
        canvasWidth: source.canvasWidth,
        canvasHeight: source.canvasHeight,
        templateSlug: source.templateSlug,
        outputs: null,
        organizationId,
        createdById,
      })
      .returning();
    inserted = row;
  } catch (error) {
    logError('graphics.regenerateGraphic.insert', error, {
      feature: 'graphics',
      extra: { graphicId, organizationId },
    });
  }
  if (!inserted) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to insert replacement graphic'
      )
    );
  }

  // ── 4. Enqueue the render-only job (pinned template) ───────────────────
  const priorImageUrl = source.outputs?.[0]?.url ?? undefined;
  // Carry the copy forward so the writer AMENDS it rather than inventing a new
  // deck — otherwise "change the headline" rewrites every other line too.
  const priorCopy = source.renderedCopy ?? undefined;
  const enqueue = await queueGraphicGenerate({
    mode: 'render-only',
    graphicId: newGraphicId,
    organizationId,
    ...(contentBatchId ? { contentBatchId } : {}),
    serviceId: source.serviceId,
    topicSummary: source.topicSummary ?? 'Promote service',
    kind: source.kind,
    brandPrimaryColor,
    allowAiImages: source.allowAiImages ?? false,
    sourceAssetIds: sourceAssetIds ?? source.sourceAssetIds ?? undefined,
    usageType: effectiveUsageType,
    ...(source.offerId ? { offerId: source.offerId } : {}),
    refinementInstruction,
    priorCopy,
    // Explicit when the caller stated it; inferred below otherwise.
    regenerationIntent:
      regenerationIntent ??
      (sourceAssetIds?.length
        ? 'image'
        : refinementInstruction
          ? 'copy'
          : undefined),
    templateSlug: source.templateSlug ?? undefined,
    // Anchor the regeneration to what it is editing.
    //
    // A single graphic anchors to its own prior image. A carousel cannot —
    // `priorImageUrl` here is `outputs[0].url`, which is slide 1 and nothing
    // else — so it anchors to the SOURCE GRAPHIC and the worker resolves each
    // slide's own prior image from its preserved `outputs[]`.
    //
    // Until now the carousel branch passed neither, so a whole-carousel refine
    // was structurally incapable of being an edit: it replanned the copy and
    // re-rendered every slide from the curated inspiration image, with the
    // user's instruction as a free-text nudge. "Make the headline shorter"
    // returned a different deck. That is ~40% of graphics.
    ...(effectiveScope === 'slide'
      ? { slideInstructions: targetedSlides, priorGraphicId: source.id }
      : source.kind === 'single'
        ? { priorImageUrl }
        : // Whole-carousel: the worker refines each slide from its own prior
          // image when it can, and falls back to a re-roll when it cannot
          // (no pinned template, or no instruction to apply).
          { priorGraphicId: source.id }),
    ...(whatsappDelivery ? { whatsappDelivery } : {}),
  });
  if (!enqueue.success) {
    await db
      .update(graphic)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(graphic.id, newGraphicId))
      .catch(() => {});
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to enqueue regeneration: ${enqueue.error.message}`
      )
    );
  }

  return ok(inserted);
};

export const regenerateGraphic = (
  db: DbConnection,
  input: RegenerateGraphicInput
) =>
  trackedResult(
    'graphics.regenerateGraphic',
    () => regenerateGraphicImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        graphicId: input.graphicId,
        scope: input.scope,
      },
    }
  );

export type RegenerateGraphicResult = Awaited<
  ReturnType<typeof regenerateGraphic>
>;
