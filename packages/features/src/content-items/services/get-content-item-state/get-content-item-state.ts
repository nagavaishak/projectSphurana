import {
  contentAttempt,
  video,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import type { DbConnection, Result } from '../../../shared/index.js';
import { err, ok } from '../../../shared/index.js';
import {
  activeTemplateKey,
  templateTextFields,
} from '../../../videos/index.js';
import { loadSlotForOrg } from '../load-slot/index.js';

export interface GetContentItemStateInput {
  itemId: string;
  organizationId: string;
  /**
   * Report the asset on THIS attempt rather than the live one.
   *
   * A card in the transcript belongs to the cut it was emitted against, and a
   * later edit moves the item on. Without this, a draft card from turn 1 read
   * the CURRENT attempt and started pointing at the graphic turn 2 produced —
   * so two rows in the same conversation showed the same carousel, and both
   * highlighted as open.
   */
  attemptId?: string;
  /**
   * Report the asset on the attempt with THIS number instead.
   *
   * For a card that opened its own item, the answer is always attempt 0 — and
   * unlike `attemptId` it needs nothing stored in the card to say so. That
   * matters because tool outputs are PERSISTED: a card written before
   * `attemptId` existed can never gain one, and would otherwise keep reading
   * the live cut and pointing at content a later turn produced.
   */
  attemptNumber?: number;
}

export interface ContentItemState {
  itemId: string;
  kind: 'video' | 'graphic';
  /** The live cut. A card compares it to the one it was emitted against. */
  attemptId: string;
  /**
   * The asset on the live cut, or null when this item is still only a PROPOSAL
   * — shown to the owner, not yet acted on.
   *
   * This is the whole reason the endpoint exists: it is the one fact a card
   * cannot know about itself. "Have I already been accepted?" was previously
   * answered from React state, which a remount throws away, so a spent card
   * came back offering to generate a second copy of what it had already made.
   */
  assetId: string | null;
  /** True when the reported attempt is no longer the item's live cut. */
  superseded: boolean;
  reviewStatus: string;
  /**
   * Pages the planner already picked for this post.
   *
   * The panel seeds its page pills from these. Without them the toggles start
   * empty, so tapping a page the planner had chosen ADDS a duplicate instead of
   * removing it, and the post goes out to somewhere nobody selected.
   */
  targetPageIds: string[];
  /** Copy for the live cut, so a scheduler can send it unchanged. */
  caption: string | null;
  /**
   * The words ON a video, field by field — `{ items: ['…','…'], title: '…' }`.
   *
   * Empty for graphics (their copy is baked into the image) and for videos with
   * no editable template block.
   *
   * This is what makes "change point 3" answerable. In an ordinary chat the
   * copy is already in the transcript — `createDraftVideo` returns its
   * `textFrames` — so Claire can read back what she made. A queued post has no
   * such turn, and without this she could only ask the owner what point 3 said
   * while they were looking at it.
   */
  textFields: Record<string, string | string[]>;
  /** The template block those fields live under, e.g. `numberedList`. */
  templateKey: string | null;
  /**
   * A re-roll PROPOSED and not yet paid for.
   *
   * Held rather than fired because a re-roll costs a render and replaces what
   * is on screen, so the owner presses the button. The button only existed on
   * the review page — in chat the proposal was staged, invisible, and reported
   * as done ("slide 6 has been refreshed") over a slide that had not changed.
   */
  pendingRegenerate: PendingRegenerateEdit[] | null;
}

/** One entry of a proposed re-roll. Mirrors the slot column. */
export interface PendingRegenerateEdit {
  /** 0-based carousel slide, or null for the whole asset. */
  slideIndex: number | null;
  op: 'refine' | 'remove';
  note?: string;
  intent?: 'copy' | 'image' | 'branding' | 'full';
}

/** The item, as a card needs to see it: which cut is live, and is it made yet. */
const getContentItemStateImpl = async (
  db: DbConnection,
  input: GetContentItemStateInput
): Promise<Result<ContentItemState>> => {
  const loaded = await loadSlotForOrg(db, input);
  if (!loaded.success) return err(loaded.error);

  const { slot, attempt } = loaded.data;

  // The named attempt when the caller has one, the live cut otherwise. Scoped
  // to this slot so an attempt id from another item cannot be read through it.
  let named = attempt;
  const wantsOther =
    (input.attemptId && input.attemptId !== attempt.id) ||
    (input.attemptNumber !== undefined &&
      input.attemptNumber !== attempt.attemptNumber);
  if (wantsOther) {
    const [row] = await withOrgScope(
      (tx) =>
        tx
          .select()
          .from(contentAttempt)
          .where(
            and(
              eq(contentAttempt.slotId, slot.id),
              input.attemptId
                ? eq(contentAttempt.id, input.attemptId)
                : eq(
                    contentAttempt.attemptNumber,
                    input.attemptNumber as number
                  )
            )
          )
          .limit(1),
      { db }
    );
    if (row) named = row;
  }

  // Only videos have editable on-screen text, and only when the attempt still
  // points at a video row. A missing row is not an error here — the state is
  // still worth reporting without it.
  let textFields: Record<string, string | string[]> = {};
  let templateKey: string | null = null;
  if (slot.kind === 'video' && named.videoId) {
    const [row] = await withOrgScope(
      (tx) =>
        tx
          .select({ draftConfig: video.draftConfig })
          .from(video)
          .where(eq(video.id, named.videoId as string))
          .limit(1),
      { db }
    );
    if (row?.draftConfig) {
      textFields = templateTextFields(row.draftConfig);
      templateKey = activeTemplateKey(row.draftConfig);
    }
  }

  return ok({
    itemId: slot.id,
    kind: slot.kind,
    attemptId: named.id,
    assetId: named.videoId ?? named.graphicId ?? null,
    /** True when `attemptId` is no longer the item's live cut. */
    superseded: named.id !== attempt.id,
    reviewStatus: slot.reviewStatus,
    targetPageIds: slot.targetPageIds ?? [],
    caption: named.caption ?? null,
    textFields,
    templateKey,
    pendingRegenerate: Array.isArray(slot.pendingRegenerate)
      ? (slot.pendingRegenerate as PendingRegenerateEdit[])
      : null,
  });
};

export const getContentItemState = (
  db: DbConnection,
  input: GetContentItemStateInput
) =>
  trackedResult(
    'contentItems.getContentItemState',
    () => getContentItemStateImpl(db, input),
    {
      properties: {
        itemId: input.itemId,
        organizationId: input.organizationId,
      },
      internalErrorsOnly: true,
    }
  );
