import {
  contentItemStateSchema,
  reviewTurnResponseSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

/**
 * Paths this tool reaches that the global whitelist does not carry.
 *
 * The item endpoints live under `content-batches/` for historical reasons — a
 * batch was once the only thing that could own an item. They are item-scoped,
 * not batch-scoped, and a Claire-made post uses them exactly as a planned one
 * does.
 */
const CONTENT_ITEM_PATHS = [
  /^content-batches\/items\/[a-zA-Z0-9_-]+\/state$/,
  /^content-batches\/items\/[a-zA-Z0-9_-]+\/messages$/,
] as const;

interface PatchContentOutput {
  itemId?: string;
  kind?: 'video' | 'graphic';
  /** The live cut, so a card can stamp itself with the version it was drawn for. */
  attemptId?: string;
  assetId?: string | null;
  uiState?: 'created';
  title?: string;
  fields?: { label: string; value: string }[];
  /** Set when the change is waiting on the owner to spend a render. */
  awaitingApproval?: boolean;
  error?: string;
}

/**
 * `content_patchContent` — change a piece of content, in the owner's words.
 *
 * ONE TOOL, ONE ID, ONE FREE-TEXT INSTRUCTION. It replaces five:
 * `patchDraftVideo`, `regenerateGraphic`, `editVideoClips`, `regenerateItem`
 * and `updateItemCaption`.
 *
 * THE INSTRUCTION IS THE INPUT — there is no `change` parameter, deliberately.
 * Which lever an instruction pulls depends on the item's kind, its active
 * template block, the current value of every text field on it, and its clip
 * list. None of that is reliably in front of the model, and all of it is
 * already in front of the server. Making the model choose produced exactly two
 * failures, repeatedly:
 *
 *   - the WRONG LEVER — "the caption" read as the on-screen text, which is free
 *     versus a render, or a graphic sent down a text-patch path that cannot
 *     exist because its words are pixels; and
 *   - the WRONG SHAPE — authoring `{ numberedList: { items: [...] } }` from
 *     scratch to change one entry, which is how "change point 3" kept editing
 *     the wrong field.
 *
 * Both vanish when the instruction is relayed rather than interpreted. A wrong
 * pick used to come back as a not-found, which is indistinguishable from "this
 * post cannot be edited" — the whole provenance of "the post may be locked on
 * the platform side", said over a post that was perfectly editable.
 *
 * An optional `change` override was considered and rejected: a second path is a
 * path that drifts, and the classifier stops being the single answer the moment
 * anything is allowed around it.
 *
 * The classifier is `handleReviewTurn`, behind
 * `POST /content-batches/items/:itemId/messages`. It resolves exactly ONE
 * action per turn — the caption is free and the pixels are a render, and a turn
 * that quietly did both would make the history unreadable — and it STAGES video
 * edits rather than firing them, so several instructions cost one render and
 * the owner still holds the decision to spend it.
 *
 * The ITEM is the address because editing a rendered video FORKS it, and the
 * item is what follows the fork. Address the video and the fork's id ends up
 * somewhere only the browser can see, so "render it now" finds the cut the
 * owner already replaced and correctly reports nothing to do.
 */
export const patchContentTool = defineTool<
  { itemId: string; instruction: string },
  PatchContentOutput
>({
  feature: 'content',
  action: 'patchContent',
  description:
    'Change a piece of content — a video or a graphic — by its ITEM id. This ' +
    'is the ONE tool for every edit: the caption, the words on a video, the ' +
    "clips, or a whole new version. Pass the owner's request as " +
    '`instruction`, in their words. Do NOT decide which of those it is, do ' +
    'not rewrite the caption yourself, and do not restate the current copy ' +
    "back to them — the server holds the item's kind, its template fields " +
    'and its clip list, works out which change is being asked for, and makes ' +
    'it. Anything that costs a render is staged for the owner to approve on ' +
    'the card, so this is safe to call for any change request. When it comes ' +
    'back AWAITING APPROVAL, nothing has happened yet: the card carries the ' +
    'button that pays for it. Say what is proposed, never that it is done.',
  inputSchema: z.object({
    itemId: z
      .string()
      .min(1)
      .describe(
        'The POST being changed — the content item id, named on your active ' +
          'context. NOT the video or graphic id.'
      ),
    instruction: z
      .string()
      .min(1)
      .max(600)
      .describe(
        'What the owner asked for, in their words — "make the caption less ' +
          'salesy", "change point 3 to mention winter pricing", "get rid of ' +
          'clip 2", "redo slide 2 and make it warmer". Relay it; do not ' +
          'classify it, and do not translate it into field names.'
      ),
  }),
  destructive: false,
  // Any member can edit their own org's post. The gate that matters is the
  // render approval on the card, which is the owner's, not a role check.
  policy: 'member',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Making the change' },
  additionalAllowedPaths: CONTENT_ITEM_PATHS,
  execute: async (input, ctx) => {
    // Which cut is live, and what kind of thing is this. Read first so the card
    // can stamp itself even when the turn below changes nothing.
    let state: z.infer<typeof contentItemStateSchema> | null = null;
    try {
      state = await ctx.apiFetch(
        `content-batches/items/${input.itemId}/state`,
        { schema: contentItemStateSchema }
      );
    } catch (error) {
      return {
        data: {
          error:
            `Could not load this post (itemId used: ${input.itemId} — it must be the ITEM id, not the video or graphic id). ${
              error instanceof Error ? error.message : ''
            }`.trim(),
        },
      };
    }

    let turn: z.infer<typeof reviewTurnResponseSchema>;
    try {
      turn = await ctx.apiFetch(
        `content-batches/items/${input.itemId}/messages`,
        {
          schema: reviewTurnResponseSchema,
          method: 'POST',
          body: { instruction: input.instruction },
        }
      );
    } catch (error) {
      // Relayed verbatim. When a call fails, what came back IS the next step —
      // reaching for an explanation of our own is how an owner got sent to
      // email a colleague about a feature that works.
      return {
        data: {
          itemId: state.itemId,
          kind: state.kind,
          attemptId: state.attemptId,
          error:
            error instanceof Error
              ? error.message
              : 'Could not make that change',
        },
      };
    }

    const base = {
      itemId: state.itemId,
      kind: state.kind,
      attemptId: state.attemptId,
      assetId: state.assetId,
    };

    // What the turn actually did, described from what came back rather than
    // from what was asked for. The two differ whenever the classifier read the
    // instruction differently than the model would have — which is the point of
    // it — and reporting the request as though it were the outcome is how a
    // refused edit gets announced as a completed one.
    const fields: { label: string; value: string }[] = [];
    const clipEdits = turn.stagedEdits?.clips ?? [];
    const textChanges = turn.stagedEdits?.textChanges ?? [];

    for (const change of textChanges) {
      fields.push({ label: 'On-screen text', value: change });
    }
    for (const clip of clipEdits) {
      fields.push({
        label: 'Clips',
        value:
          clip.op === 'relist'
            ? `Re-ordered — ${clip.clipCount} clips`
            : clip.op === 'remove'
              ? `Removed clip ${clip.clipNumber}`
              : `Swapped clip ${clip.clipNumber}`,
      });
    }
    if (turn.pendingRegenerate?.length) {
      for (const edit of turn.pendingRegenerate) {
        fields.push({
          label:
            edit.slideIndex === null
              ? 'New version'
              : `Slide ${edit.slideIndex + 1}`,
          value: edit.op === 'remove' ? 'Remove' : (edit.note ?? 'Regenerate'),
        });
      }
    }

    const awaitingApproval =
      clipEdits.length > 0 ||
      textChanges.length > 0 ||
      (turn.pendingRegenerate?.length ?? 0) > 0;

    // Nothing staged and no pixels proposed means the caption is what moved —
    // the free, instant, already-applied case.
    if (!awaitingApproval) {
      fields.push({ label: 'Caption', value: turn.caption });
    } else {
      // SAY IT IS NOT DONE.
      //
      // The review turn stages anything that costs a render and its own prompt
      // is explicit that nothing is spent — but that instruction is given to
      // the classifier, and the model that talks to the owner is a different
      // one reading only this output. Handed a card and a list of changes, it
      // wrote "Done — slide 6 has been refreshed" over a slide that had not
      // changed.
      fields.push({
        label: 'Status',
        value: 'Waiting for you to confirm — nothing has been spent yet',
      });
    }

    return {
      // The tool NAMES its card rather than leaving the renderer to infer one
      // from its name. A clip or text change comes back as the clip list with
      // the approval attached — the owner sees what changed and holds the
      // decision to spend the render. A caption change has nothing to approve.
      //
      // Naming it matters more here than anywhere: this tool replaced five, and
      // a renderer keyed on tool names would have rendered nothing for the one
      // that replaced them. That is not hypothetical — it is exactly how
      // `regenerateItem` shipped with Claire announcing "confirm on the card
      // above" over a card that did not exist.
      // ALWAYS the post's own card, re-shown prefilled. There is ONE card per
      // post and every change comes back through it — the same card the owner
      // approved the video on, with whatever just changed already in it.
      //
      // This branched on whether the change cost a render: a caption edit got
      // `{ type: 'none' }` and later a bespoke caption card, on the reasoning
      // that a free change has nothing to approve. True, and beside the point.
      // The card is not only an approval — it is the post. Suppressing it left
      // Claire typing the caption out in chat as the only evidence, which is
      // the narration she is told to avoid and the one form of evidence the
      // owner cannot check; a second card shape for one lever put the post in
      // two places depending on which word was edited.
      //
      // A graphic has no clip list, so it gets its own card for the same
      // reason: show the thing that changed, in the form it already has.
      presentation:
        state.kind === 'video'
          ? {
              type: 'content_clips' as const,
              itemId: state.itemId,
              attemptId: state.attemptId,
              title: awaitingApproval ? 'Ready to render' : undefined,
            }
          : state.assetId
            ? {
                type: 'graphic_status' as const,
                graphicId: state.assetId,
                itemId: state.itemId,
              }
            : // Still a PROPOSAL — nothing has been generated, so there is no
              // graphic to point a card at. An empty id here rendered a card
              // pointed at nothing.
              { type: 'none' as const },
      data: {
        ...base,
        uiState: 'created' as const,
        awaitingApproval,
        title: awaitingApproval ? 'Ready to render' : 'Caption updated',
        fields,
      },
    };
  },
});
