import type { Graphic } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type RegenerateGraphicInput,
  regenerateGraphic,
} from '../../../graphics/index.js';
import {
  type DbConnection,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type PatchDraftConfigInput,
  type PatchDraftConfigOutput,
  patchDraftConfig,
} from '../../../videos/index.js';
import { ensureItemForAsset } from '../ensure-item-for-asset/index.js';
import { recordAttempt } from '../record-attempt/index.js';

/** Shared by both kinds — the bookkeeping half of the call. */
interface ReviseContentCommon {
  /** Which surface asked. Only used when the asset is being adopted. */
  source?: 'claire_chat' | 'content_studio';
  /**
   * What the owner asked for, in their words. The whole reason an attempt is a
   * row: without it a re-roll is indistinguishable from a fresh generate.
   */
  refinementInstruction?: string;
  /**
   * The caption to carry onto the new cut. A cut's caption is per-attempt, so
   * omitting it silently blanks the post text on content that was only meant to
   * have its clips reordered.
   */
  caption?: string | null;
  /** See `RecordAttemptInput`. The clip list editor passes false. */
  countsAsRegeneration?: boolean;
  /** See `RecordAttemptInput`. Carried forward so the tally survives the fork. */
  editRenderCount?: number;
}

export type ReviseContentInput =
  | ({ kind: 'video' } & Omit<PatchDraftConfigInput, 'preserveRendered'> &
      ReviseContentCommon)
  | ({ kind: 'graphic' } & RegenerateGraphicInput & ReviseContentCommon);

interface ReviseContentBase {
  itemId: string;
  /** -1 when the attempt could not be written — see below. */
  attemptNumber: number;
}

/**
 * A UNION, not one shape with optional halves.
 *
 * `{ video?, graphic? }` would make every caller check a field it already knows
 * the answer to, and would let a graphic path read `.video` and get undefined
 * at runtime rather than a compile error. The caller passed `kind`; it can
 * narrow on it.
 */
export type ReviseContentOutput =
  | (ReviseContentBase & { kind: 'video' } & PatchDraftConfigOutput)
  | (ReviseContentBase & { kind: 'graphic'; graphic: Graphic });

/**
 * Edit a standalone piece of content, preserving the cut being edited.
 *
 * ONE SERVICE, because the interesting half is identical for both kinds:
 *
 *   1. ensure the item exists (adopting an asset that predates item tracking)
 *   2. produce the new cut
 *   3. record it as the item's next attempt
 *
 * Only step 2 differs — a video is patched with copy-on-write, a graphic is
 * re-rolled into a new row. Steps 1 and 3 are the bookkeeping that makes an
 * edit reachable afterwards, and they were previously written out twice. That
 * is the shape every bug in this area has taken: a rule applied to one kind and
 * not the other, with nothing to make the omission visible.
 *
 * ORDER IS LOAD-BEARING. The item is ensured BEFORE anything is rendered, so a
 * render that starts can always be attributed. After, there would be a window
 * where content is rendering with nothing recording why.
 *
 * `preserveRendered` is forced on for videos. It is not a caller's choice on
 * this path: an owner editing their finished video always wants the finished
 * video to survive. It stays OFF for the wizard, which patches an unrendered
 * draft on every interaction and would otherwise mint a row per keystroke.
 */
const reviseContentImpl = async (
  db: DbConnection,
  input: ReviseContentInput
): Promise<Result<ReviseContentOutput>> => {
  const {
    source = 'claire_chat',
    refinementInstruction,
    caption,
    countsAsRegeneration,
    editRenderCount,
  } = input;

  const item = await ensureItemForAsset(db, {
    organizationId: input.organizationId,
    ...(input.kind === 'video'
      ? { videoId: input.videoId }
      : { graphicId: input.graphicId }),
    source,
  });
  if (!item.success) return err(item.error);

  if (input.kind === 'video') {
    const {
      kind: _kind,
      source: _source,
      refinementInstruction: _reason,
      caption: _caption,
      countsAsRegeneration: _counts,
      editRenderCount: _tally,
      ...patchInput
    } = input;

    const patched = await patchDraftConfig(db, {
      ...patchInput,
      preserveRendered: true,
    });
    if (!patched.success) {
      return err(
        new FeatureError(
          patched.error.code,
          patched.error.message,
          patched.error.details
        )
      );
    }

    // A patch that did not fork edited an unrendered draft. That is not a new
    // cut — there was no previous one to supersede — so recording an attempt
    // would inflate the history with versions that never existed.
    if (!patched.data.forkedFromVideoId) {
      return ok({
        ...patched.data,
        kind: 'video',
        itemId: item.data.itemId,
        attemptNumber: -1,
      });
    }

    const attempt = await recordAttempt(db, {
      itemId: item.data.itemId,
      organizationId: input.organizationId,
      videoId: patched.data.video.id,
      reason: refinementInstruction ?? null,
      caption: caption ?? null,
      countsAsRegeneration,
      editRenderCount,
    });
    // The fork exists and its render is queued. Failing here would report an
    // edit that demonstrably happened as not having happened.
    if (!attempt.success) {
      return ok({
        ...patched.data,
        kind: 'video',
        itemId: item.data.itemId,
        attemptNumber: -1,
      });
    }

    return ok({
      ...patched.data,
      kind: 'video',
      itemId: item.data.itemId,
      attemptNumber: attempt.data.attemptNumber,
    });
  }

  const {
    kind: _kind,
    source: _source,
    caption: _caption,
    countsAsRegeneration: _counts,
    editRenderCount: _tally,
    ...regenerateInput
  } = input;

  const rendered = await regenerateGraphic(db, regenerateInput);
  if (!rendered.success) {
    return err(
      new FeatureError(
        rendered.error.code,
        rendered.error.message,
        rendered.error.details
      )
    );
  }

  const attempt = await recordAttempt(db, {
    itemId: item.data.itemId,
    organizationId: input.organizationId,
    graphicId: rendered.data.id,
    reason: refinementInstruction ?? null,
    caption: caption ?? null,
    countsAsRegeneration,
    editRenderCount,
  });
  // Same call as the video path: the render is queued and the row exists, so
  // failing the whole call would tell the owner their edit did not happen while
  // it demonstrably did. `trackedResult` has already carried it to Sentry.
  if (!attempt.success) {
    return ok({
      kind: 'graphic',
      graphic: rendered.data,
      itemId: item.data.itemId,
      attemptNumber: -1,
    });
  }

  return ok({
    kind: 'graphic',
    graphic: rendered.data,
    itemId: item.data.itemId,
    attemptNumber: attempt.data.attemptNumber,
  });
};

export const reviseContent = (db: DbConnection, input: ReviseContentInput) =>
  trackedResult(
    'contentItems.reviseContent',
    () => reviseContentImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        kind: input.kind,
        assetId: input.kind === 'video' ? input.videoId : input.graphicId,
        hasInstruction: Boolean(input.refinementInstruction),
      },
    }
  );
